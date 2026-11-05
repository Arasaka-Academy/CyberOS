"""Download immutable model files, verifying upstream Git/LFS object identities."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

MODEL = "Qwen/Qwen3-VL-Embedding-2B"
REVISION = "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda"
WEIGHT_SHA256 = "c73fa9caeddeb3ff831d46c085a7a5708343248ca777e90f2d486964464509c1"


def fetch(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()


def digest(path, lfs):
    algorithm = hashlib.sha256() if lfs else hashlib.sha1()
    if not lfs:
        algorithm.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            algorithm.update(block)
    return algorithm.hexdigest()


def download(destination):
    destination.mkdir(parents=True, exist_ok=True)
    metadata = None
    for host in ("https://hf-mirror.com", "https://huggingface.co"):
        try:
            metadata = json.loads(fetch(f"{host}/api/models/{MODEL}/revision/{REVISION}?blobs=true"))
            break
        except Exception as error:
            print(f"Model metadata unavailable from {host}: {type(error).__name__}", flush=True)
    if not metadata or metadata.get("sha") != REVISION:
        raise RuntimeError("Cannot verify the pinned upstream model revision")
    files = [entry for entry in metadata["siblings"] if "/" not in entry["rfilename"] and
             entry["rfilename"].endswith((".json", ".jinja", ".txt", ".safetensors"))]
    manifest = {}
    for entry in files:
        name = entry["rfilename"]
        target = destination / name
        lfs = entry.get("lfs")
        expected = lfs["sha256"] if lfs else entry.get("blobId")
        if not expected:
            raise RuntimeError(f"Missing upstream object identity: {name}")
        if name == "model.safetensors" and expected != WEIGHT_SHA256:
            raise RuntimeError("Pinned model weight identity differs from the reviewed model")
        if target.exists() and digest(target, lfs) == expected:
            print(f"Verified {name}", flush=True)
            manifest[name] = expected
            continue
        urls = [f"https://modelscope.cn/models/{MODEL}/resolve/master/{urllib.parse.quote(name)}",
                f"https://hf-mirror.com/{MODEL}/resolve/{REVISION}/{urllib.parse.quote(name)}"]
        temporary = target.with_suffix(target.suffix + ".part")
        for attempt in range(6):
            try:
                offset = temporary.stat().st_size if temporary.exists() else 0
                request = urllib.request.Request(urls[attempt % len(urls)], headers={"Range": f"bytes={offset}-"} if offset else {})
                with urllib.request.urlopen(request, timeout=60) as response:
                    append = offset > 0 and response.status == 206
                    with temporary.open("ab" if append else "wb") as stream:
                        total = offset if append else 0
                        reported = total // (100 * 1024 * 1024)
                        while block := response.read(1024 * 1024):
                            stream.write(block)
                            total += len(block)
                            if total // (100 * 1024 * 1024) > reported:
                                reported = total // (100 * 1024 * 1024)
                                print(f"{name}: {total // (1024 * 1024)} MiB", flush=True)
                if digest(temporary, lfs) != expected:
                    temporary.unlink()
                    raise RuntimeError("Downloaded file identity mismatch")
                temporary.replace(target)
                manifest[name] = expected
                print(f"Verified {name}", flush=True)
                break
            except Exception as error:
                print(f"Retry {name} ({attempt + 1}): {type(error).__name__}", flush=True)
                if attempt == 5:
                    raise
                time.sleep(min(2 ** attempt, 30))
    (destination / "cyberos-model-manifest.json").write_text(json.dumps({"model": MODEL, "revision": REVISION, "files": manifest}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    download(parser.parse_args().destination)
