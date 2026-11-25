"""Install the Facebook acceptance build verified against two real unpublished drafts."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import sys

TARGET_EXPECTED = {
    "explicit_listing_fill.js": "1cc354abe31b2a1045460ce68dc73142a97cdbb7146a7699ead3b499ef663ee9",
    "approved_batch_panel.js": "d9fd7a489da8c141ab26b3c10cb8d4d969de2eaa9ea255257e1fe60045722c54",
    "ngk_cloud_worker.js": "0c7c20c0e1eca2184051329a62a1a2ccd55355e9b0d8724d667f885441e8abad",
    "manifest.json": "ff1028cdbbe0e726a2d0562ceabaa163058f4fbfa2d586d5afee4600ffbff8bc",
}

def main(arg: str) -> None:
    target = Path(arg).resolve()
    source = Path(__file__).resolve().parent
    originals = {name: (target / name).read_bytes() for name in TARGET_EXPECTED}
    for name, data in originals.items():
        if hashlib.sha256(data).hexdigest() != TARGET_EXPECTED[name]:
            raise SystemExit("Review newer " + name + " before applying")

    backup = target.parent / "pre-facebook-acceptance-68.1.7"
    backup.mkdir(exist_ok=True)
    for name, data in originals.items():
        saved = backup / name
        if not saved.exists():
            saved.write_bytes(data)
        if saved.read_bytes() != data:
            raise SystemExit("Backup mismatch: " + name)

    manifest = json.loads(originals["manifest.json"])
    if manifest.get("version") != "68.1.7":
        raise SystemExit("Installed version changed")
    permissions = manifest.setdefault("permissions", [])
    if "debugger" not in permissions:
        permissions.append("debugger")
    manifest["version"] = "68.1.19"

    changes = {
        "explicit_listing_fill.js": (source / "explicit_listing_fill_68119.js").read_bytes(),
        "approved_batch_panel.js": (source / "approved_batch_panel_68119.js").read_bytes(),
        "ngk_cloud_worker.js": (source / "ngk_cloud_worker.js").read_bytes(),
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
    }
    staged = backup / "staged"
    staged.mkdir(exist_ok=True)
    for name, data in changes.items():
        path = staged / name
        path.write_bytes(data)
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(path)], check=True)

    written = []
    try:
        for name, data in changes.items():
            destination = target / name
            if destination.read_bytes() != originals[name]:
                raise RuntimeError("Concurrent extension change")
            temporary = target / (name + ".68119.tmp")
            temporary.write_bytes(data)
            temporary.replace(destination)
            written.append(name)
            if destination.read_bytes() != data:
                raise RuntimeError("Write verification failed: " + name)
    except BaseException:
        for name in reversed(written):
            destination = target / name
            if destination.read_bytes() == changes[name]:
                destination.write_bytes(originals[name])
        raise

    print("Verified on disk: Commerce OS 68.1.19 Facebook acceptance build")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: install_facebook_acceptance_68119.py EXTENSION_DIRECTORY")
    main(sys.argv[1])
