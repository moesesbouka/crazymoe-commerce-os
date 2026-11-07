"""Move the verified 68.1.19 legacy Supabase calls onto the signed-in Studio session."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

EXPECTED = {
    "background.js": "2ddb264a8562c93d68d99ce7275a56dc3291bf17a567ecc41a81f8b1fb505041",
    "gallery_bg.js": "bb676655ea607d56c47325e19672e84bac3b0b88427ade74db08d55e5622786d",
    "cloud_handoff.js": "6758390f420ba645f43d4c3fcbf183b2bc848914bb14e9364f8cdc1c05fcbd82",
    "manifest.json": "624352fb587361230983ed13874c03bdee6064a70d4753b052e8873945fe4818",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def transform_background(text):
    for old, count in (("fetch(`${cfg.url}/rest/v1/", 3), ("fetch(`${SB_URL}/rest/v1/", 6)):
        if text.count(old) != count:
            raise ValueError(f"Unexpected legacy request count for {old}")
        text = text.replace(old, "studioMemberFetch(" + old[len("fetch("):])
    return text


def transform_gallery(text):
    if text.count("fetch(url, ") != 2:
        raise ValueError("Unexpected gallery table request count")
    text = text.replace("fetch(url, ", "studioMemberFetch(url, ")
    old = 'fetch(cfg.url + "/storage/v1/object/listing-images/" + objectPath, {'
    if text.count(old) != 1:
        raise ValueError("Unexpected gallery storage request count")
    return text.replace(old, 'studioMemberFetch(cfg.url + "/storage/v1/object/listing-images/" + objectPath, {')


def install(target, source):
    original = {name: (target / name).read_bytes() for name in EXPECTED}
    if any(sha(data) != EXPECTED[name] for name, data in original.items()):
        raise SystemExit("Installed 68.1.19 sources changed. Inspect before applying.")
    backup = target.parent / "pre-member-access-68.1.20"
    backup.mkdir(exist_ok=False)
    for name, data in original.items():
        (backup / name).write_bytes(data)

    manifest = json.loads(original["manifest.json"].decode("utf-8-sig"))
    if manifest.get("version") != "68.1.19":
        raise SystemExit("Unexpected extension version")
    manifest["version"] = "68.1.20"
    manifest["description"] = "Cloud-authenticated gallery recovery and private Studio handoff"
    changes = {
        "background.js": transform_background(original["background.js"].decode("utf-8-sig")).encode(),
        "gallery_bg.js": transform_gallery(original["gallery_bg.js"].decode("utf-8-sig")).encode(),
        "cloud_handoff.js": (source / "cloud_handoff.js").read_bytes(),
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
        "member_probe.html": (source / "member_probe.html").read_bytes(),
        "member_probe.js": (source / "member_probe.js").read_bytes(),
    }
    stage = backup / "staged"
    stage.mkdir()
    for name, data in changes.items():
        path = stage / name
        path.write_bytes(data)
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(path)], check=True)

    written = []
    try:
        for name, data in changes.items():
            path = target / name
            if path.exists() and name not in original:
                raise RuntimeError("Unexpected acceptance helper already exists")
            if name in original and path.read_bytes() != original[name]:
                raise RuntimeError("Extension changed during installation")
            temp = path.with_suffix(path.suffix + ".68-1-20.tmp")
            with temp.open("xb") as stream:
                stream.write(data)
            temp.replace(path)
            written.append(name)
        if any((target / name).read_bytes() != data for name, data in changes.items()):
            raise RuntimeError("Installed file verification failed")
    except BaseException:
        for name in reversed(written):
            path = target / name
            if path.read_bytes() == changes[name]:
                if name in original:
                    path.write_bytes(original[name])
                else:
                    path.unlink()
        raise
    print("Verified on disk: 68.1.20", len(written), "files")


if __name__ == "__main__":
    install(Path(sys.argv[1]).resolve(), Path(__file__).resolve().parent)
