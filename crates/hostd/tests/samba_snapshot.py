"""Run as root with Samba installed; all passdb writes use a temporary database."""

import json
import os
import pathlib
import stat
import subprocess
import tempfile

import tdb

helper = (pathlib.Path(__file__).parents[1] / "src/shares/samba_snapshot.py").read_text()

with tempfile.TemporaryDirectory(prefix="cyberos-samba-recovery-test-") as temporary:
    root = pathlib.Path(temporary)
    for directory in ["private", "state", "lock", "cache", "recovery"]:
        (root / directory).mkdir(mode=0o700)
    configuration = root / "smb.conf"
    configuration.write_text(
        "[global]\nworkgroup=REVIEW\nnetbios name=REVIEW\nserver role=standalone server\n"
        + "passdb backend=tdbsam:" + str(root / "live.tdb") + "\n"
        + "".join(key + "=" + str(root / value) + "\n" for key, value in [
            ("private dir", "private"), ("state directory", "state"),
            ("lock directory", "lock"), ("cache directory", "cache")])
    )

    def command(program, *args, password=None):
        flag = "-c" if program == "smbpasswd" else "-s"
        result = subprocess.run([program, flag, str(configuration), *args],
                                input=password, text=True, capture_output=True, timeout=15)
        assert result.returncode == 0, program + " fixture failed"
        return result.stdout

    def recovery(action, username, backup, success=True):
        result = subprocess.run(["python3", "-c", helper], text=True, capture_output=True,
                                input=json.dumps(dict(action=action, username=username,
                                    backup=str(backup), configuration=str(configuration))), timeout=15)
        assert (result.returncode == 0) == success, result.stderr
        assert not result.stdout, "credential material must not be emitted"

    def records():
        db = tdb.open(str(root / "live.tdb"), 0, tdb.DEFAULT, os.O_RDONLY)
        try:
            return {key: db[key] for key in db.keys()}
        finally:
            db.close()

    # OS accounts are fixture identities only. Never create/change OS users.
    for username in ["nobody", "daemon"]:
        command("smbpasswd", "-s", "-a", username, password="fixture-original\nfixture-original\n")
    command("pdbedit", "-u", "nobody", "-f", "Preserved Full Name", "-h", "/fixture/preserved-home")
    command("smbpasswd", "-d", "nobody")
    original = records()
    backup = root / "recovery/existing.json"
    recovery("snapshot", "nobody", backup)
    assert stat.S_IMODE(backup.stat().st_mode) == 0o600
    command("smbpasswd", "-s", "-a", "nobody", password="fixture-new\nfixture-new\n")
    command("smbpasswd", "-e", "nobody")
    # Another account changes after snapshot and must retain the new state.
    command("smbpasswd", "-s", "-a", "daemon", password="fixture-other\nfixture-other\n")
    changed = records()
    assert changed[b"USER_nobody\0"] != original[b"USER_nobody\0"]
    recovery("restore", "nobody", backup)
    restored = records()
    assert restored[b"USER_nobody\0"] == original[b"USER_nobody\0"]
    assert restored[b"USER_daemon\0"] == changed[b"USER_daemon\0"]
    assert "Preserved Full Name" in command("pdbedit", "-L", "-v", "-u", "nobody")
    assert "/fixture/preserved-home" in command("pdbedit", "-L", "-v", "-u", "nobody")

    command("pdbedit", "-x", "-u", "daemon")
    absent = records()
    new_backup = root / "recovery/absent.json"
    recovery("snapshot", "daemon", new_backup)
    command("smbpasswd", "-s", "-a", "daemon", password="fixture-added\nfixture-added\n")
    allocated = records()
    recovery("restore", "daemon", new_backup)
    restored = records()
    assert b"USER_daemon\0" not in restored
    assert {key: value for key, value in restored.items() if key.startswith(b"RID_")} == {
        key: value for key, value in absent.items() if key.startswith(b"RID_")}
    assert restored.get(b"NEXT_RID\0") == allocated.get(b"NEXT_RID\0")
    assert restored[b"USER_nobody\0"] == original[b"USER_nobody\0"]

    # A replaced database must fail closed and retain its recovery file.
    database = root / "live.tdb"
    database.rename(root / "previous.tdb")
    replacement = tdb.open(str(database), 0, tdb.DEFAULT, os.O_RDWR | os.O_CREAT, 0o600)
    replacement.close()
    recovery("restore", "nobody", backup, success=False)
    assert backup.exists()
    assert b"USER_nobody\0" not in records()

print("Samba recovery: password, disabled flag, metadata, other account, new-account cleanup, and DB identity checks passed")
