"""Build an independent media archive and restore every object to an empty directory.

The cloud manifest digest is SHA-256 of sorted UTF-8 "object_path TAB bytes LF".
The input JSON array contains local_path, object_path and bytes for each source.
The final component of every object path is its previously verified SHA-256.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from zipfile import ZipFile

OBJECT = re.compile(r"(?:(?:originals|references|exports)/|incoming/[0-9a-f-]{36}/[0-9a-f-]{36}/)([0-9a-f]{64})")

def absolute_path(path):
    path = Path(path).resolve()
    if os.name != "nt":
        return path
    name = str(path)
    if name.startswith("\\\\?\\"):
        return path
    if name.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + name[2:])
    return Path("\\\\?\\" + name)

def manifest_digest(sizes):
    return hashlib.sha256("".join(f"{key}\t{sizes[key]}\n" for key in sorted(sizes)).encode()).hexdigest()

def verified_copy(source, dest, size, digest):
    count = 0
    checksum = hashlib.sha256()
    while block := source.read(1024 * 1024):
        count += len(block)
        if count > size:
            raise ValueError("Source exceeds its recorded size")
        checksum.update(block)
        dest.write(block)
    if count != size or checksum.hexdigest() != digest:
        raise ValueError("Object differs from its recorded size or SHA-256")

def build(sources, archive, expected):
    archive = absolute_path(archive)
    sizes = {}
    if archive.exists():
        raise FileExistsError(archive)
    with tempfile.TemporaryDirectory(dir=archive.parent) as scratch:
        candidate = Path(scratch) / "archive.zip"
        with ZipFile(candidate, "x") as output:
            for row in sources:
                key = row["object_path"]
                match = OBJECT.fullmatch(key)
                if not match or key in sizes:
                    raise ValueError("Invalid or duplicate storage path")
                sizes[key] = int(row["bytes"])
                with absolute_path(row["local_path"]).open("rb") as source, output.open(key,"w") as dest:
                    verified_copy(source, dest, sizes[key], match[1])
        if manifest_digest(sizes) != expected:
            raise ValueError("Source manifest differs from cloud inventory")
        # An exclusive hard link also prevents overwriting another backup on retry.
        archive.hardlink_to(candidate)

def restore(archive, target, expected):
    archive, target = absolute_path(archive), absolute_path(target)
    target.mkdir(mode=0o700,exist_ok=False)
    with ZipFile(archive) as source:
        entries = source.infolist()
        sizes = {e.filename:e.file_size for e in entries}
        if len(sizes) != len(entries) or manifest_digest(sizes) != expected:
            raise ValueError("Archive manifest differs from cloud inventory")
        for entry in entries:
            match = OBJECT.fullmatch(entry.filename)
            if not match:
                raise ValueError("Invalid archive path")
            path = target / entry.filename
            path.parent.mkdir(parents=True,exist_ok=True)
            with source.open(entry) as stream, path.open("xb") as dest:
                verified_copy(stream, dest, entry.file_size, match[1])
            with path.open("rb") as disk:
                if hashlib.file_digest(disk,"sha256").hexdigest() != match[1]:
                    raise ValueError("Restored file checksum mismatch")
    return {"verified_objects":len(sizes),"verified_bytes":sum(sizes.values()),"manifest_sha256":expected}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    parser.add_argument("target",type=Path,help="New, empty restore directory")
    parser.add_argument("manifest_sha256")
    parser.add_argument("--sources",type=Path,help="Build a new archive from this private source map first")
    args = parser.parse_args()
    if args.sources:
        build(json.loads(args.sources.read_text(encoding="utf-8-sig")),args.archive,args.manifest_sha256)
    print(json.dumps(restore(args.archive,args.target,args.manifest_sha256)))
