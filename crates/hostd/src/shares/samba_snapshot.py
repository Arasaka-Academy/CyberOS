"""Private, per-account recovery for the packaged standalone tdbsam backend.

Run only by hostd through stdin JSON. Password hashes never pass through argv or
stdout. Restore raw account/RID records inside a TDB transaction so metadata and
other accounts survive; the global RID allocator is deliberately not rewound.
"""

import base64
import json
import os
import pathlib
import stat
import sys

import tdb
from samba.samba3 import param


class RecoveryError(Exception):
    """An operator-facing failure containing no credential values."""


def encode(value):
    return None if value is None else base64.b64encode(value).decode("ascii")


def decode(value):
    return None if value is None else base64.b64decode(value, validate=True)


def main():
    request = json.load(sys.stdin)
    backup = pathlib.Path(request["backup"])
    directory = backup.parent.stat()
    if directory.st_uid != os.geteuid() or stat.S_IMODE(directory.st_mode) != 0o700:
        raise RecoveryError("recovery directory must be private")
    username = request["username"].encode("ascii")
    key = b"USER_" + username + b"\0"
    lp = param.get_context()
    lp.load(request["configuration"])
    backend = lp.get("passdb backend")
    if backend != "tdbsam" and not backend.startswith("tdbsam:"):
        raise RecoveryError("credential recovery requires the standalone tdbsam backend")
    database = pathlib.Path(backend.split(":", 1)[1]) if ":" in backend else pathlib.Path(lp.get("private dir")) / "passdb.tdb"
    # Never replace the live DB: Samba and concurrent clients can hold it open.
    flags = os.O_RDWR | (os.O_CREAT if request["action"] == "snapshot" else 0)
    db = tdb.open(str(database), 0, tdb.DEFAULT | tdb.SEQNUM, flags, 0o600)
    db.transaction_start()
    try:
        identity = database.stat()
        rid_keys = [k for k in db.keys() if k.startswith(b"RID_") and db.get(k) == username + b"\0"]
        if request["action"] == "snapshot":
            record = {
                "database": str(database), "device": identity.st_dev, "inode": identity.st_ino,
                "version": encode(db.get(b"INFO/version\0")),
                "username": request["username"], "account": encode(db.get(key)),
                "rids": {encode(k): encode(db.get(k)) for k in rid_keys},
            }
            fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(record, output)
                output.flush()
                os.fsync(output.fileno())
            directory_fd = os.open(backup.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        elif request["action"] == "restore":
            with backup.open() as source:
                record = json.load(source)
            if (record["database"], record["device"], record["inode"], record["username"]) != (str(database), identity.st_dev, identity.st_ino, request["username"]):
                raise RecoveryError("passdb identity changed; recovery record retained")
            if record["version"] is not None and decode(record["version"]) != db.get(b"INFO/version\0"):
                raise RecoveryError("passdb format changed; recovery record retained")
            for rid in rid_keys:
                del db[rid]
            account = decode(record["account"])
            if account is None:
                if key in db:
                    del db[key]
            else:
                db[key] = account
            for rid, value in record["rids"].items():
                rid, value = decode(rid), decode(value)
                if rid in db and db[rid] != value:
                    raise RecoveryError("RID ownership changed; recovery record retained")
                db[rid] = value
        else:
            raise RecoveryError("unknown credential recovery action")
        db.transaction_commit()
    except BaseException:
        db.transaction_cancel()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except RecoveryError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Values in backend exceptions can contain credential material.
        print("Samba credential recovery failed (" + type(error).__name__ + ")", file=sys.stderr)
        sys.exit(1)
