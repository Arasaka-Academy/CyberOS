"""Install the private model daemon on an Apple Silicon Mac, without exposing its key."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path, default=Path.home() / "Library/Application Support/CyberOS/photos-embedding")
    parser.add_argument("--python", default="/opt/homebrew/bin/python3.13")
    parser.add_argument("--index-url", default="https://pypi.org/simple")
    args = parser.parse_args()
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        parser.error("The model service requires Apple Silicon macOS")
    base = args.destination.resolve()
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(base, 0o700)
    for name in ("service.py", "requirements.lock", "download_model.py"):
        source = Path(__file__).with_name(name)
        target = base / name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
    python = base / "venv/bin/python"
    if not python.exists():
        subprocess.run([args.python, "-m", "venv", str(base / "venv")], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--index-url", args.index_url, "-r", str(base / "requirements.lock")], check=True)
    subprocess.run([str(python), str(base / "download_model.py"), str(base / "model")], check=True)
    token = base / "api-key"
    if not token.exists():
        with open(token, "x", opener=lambda file, flags: os.open(file, flags, 0o600)) as output:
            output.write(secrets.token_urlsafe(48) + "\n")
    os.chmod(token, 0o600)
    config = base / "config.json"
    config.write_text(json.dumps({"modelPath": str(base / "model"), "tokenFile": str(token)}, indent=2) + "\n")
    os.chmod(config, 0o600)
    label = "io.cyberos.photos-embedding"
    plist = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
    plist.parent.mkdir(parents=True, exist_ok=True)
    settings = {
        "Label": label, "ProgramArguments": [str(python), str(base / "service.py"), "--config", str(config)],
        "WorkingDirectory": str(base), "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
        "StandardOutPath": str(base / "service.log"), "StandardErrorPath": str(base / "service-error.log"),
        "EnvironmentVariables": {"HF_HUB_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"},
    }
    # Only this service is replaced; existing launchd and Tailscale routes stay intact.
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{label}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with plist.open("wb") as output:
        plistlib.dump(settings, output)
    subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], check=True)
    print("Model daemon installed on 127.0.0.1:8766. API key is stored in a private file.")


if __name__ == "__main__":
    main()
