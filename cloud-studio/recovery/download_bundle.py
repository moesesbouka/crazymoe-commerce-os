"""Copy an operator-authorized short-lived recovery plan to a new private directory.

Optionally reuses a prior ZIP; every reused or downloaded byte is hash checked.
Only exact Supabase private storage URLs are accepted; redirects are forbidden.
No long-lived credential is needed by this downloader.
"""
import argparse
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.parse import urlsplit, unquote
from urllib.request import HTTPRedirectHandler, build_opener
from zipfile import ZipFile

from verify_bundle import OBJECT, SHA, positive_size, unique_object, verify

HOST = "sfheqjnxlkygjfohoybo.supabase.co"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Recovery download redirect rejected")


def check_url(url, path):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != HOST or parsed.fragment
            or unquote(parsed.path) != "/storage/v1/object/sign/studio-originals/" + path):
        raise ValueError("Recovery URL outside exact private storage object")


def copy_verified(source, target, size, sha):
    checksum, count = hashlib.sha256(), 0
    while block := source.read(1024 * 1024):
        count += len(block)
        if count > size:
            raise ValueError("Recovery object exceeds receipt size")
        checksum.update(block)
        target.write(block)
    if count != size or checksum.hexdigest() != sha:
        raise ValueError("Recovery object hash or size mismatch")


def download(plan, destination, cache=None):
    destination = Path(destination)
    if destination.exists():
        raise FileExistsError("Recovery destination already exists")
    if plan.get("format") != 1:
        raise ValueError("Invalid recovery plan")
    snapshot, objects = plan["snapshot"], plan["objects"]
    import re
    if not re.fullmatch(r"recovery/[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-f0-9-]{36}\.json\.gz", snapshot["path"]):
        raise ValueError("Invalid snapshot path")
    if not SHA.fullmatch(snapshot["sha256"]):
        raise ValueError("Invalid snapshot hash")
    positive_size(snapshot["bytes"])
    check_url(snapshot["url"], snapshot["path"])
    seen = set()
    for obj in objects:
        match = OBJECT.fullmatch(obj["path"])
        if not match or match[1] != obj["sha256"] or obj["path"] in seen:
            raise ValueError("Invalid or duplicate recovery object")
        seen.add(obj["path"])
        positive_size(obj["bytes"])
        check_url(obj["url"], obj["path"])
    opener = build_opener(NoRedirect())
    with tempfile.TemporaryDirectory(prefix="recovery-stage-", dir=destination.parent) as temp:
        root = Path(temp) / "verified"
        root.mkdir(mode=0o700)
        core = root / "core.json.gz"
        with opener.open(snapshot["url"], timeout=60) as source, core.open("xb") as out:
            copy_verified(source, out, snapshot["bytes"], snapshot["sha256"])
        reused = downloaded = 0
        with (ZipFile(cache) if cache else nullcontext()) as prior, ZipFile(root / "media.zip", "x") as archive:
            old = set(prior.namelist()) if prior else set()
            for obj in objects:
                source = prior.open(obj["path"]) if obj["path"] in old else opener.open(obj["url"], timeout=60)
                with source, archive.open(obj["path"], "w") as out:
                    copy_verified(source, out, obj["bytes"], obj["sha256"])
                if obj["path"] in old:
                    reused += 1
                else:
                    downloaded += 1
        result = verify(core, root / "media.zip", snapshot["sha256"])
        result.update({"reused_objects": reused, "downloaded_objects": downloaded})
        (root / "verified.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        # Windows refuses an existing destination; explicit existence check also
        # protects ordinary retries on all supported platforms.
        if destination.exists():
            raise FileExistsError("Recovery destination already exists")
        root.rename(destination)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)
    print(json.dumps(download(plan, args.destination, args.cache), indent=2))
