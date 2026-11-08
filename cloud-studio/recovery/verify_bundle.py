"""Offline verification of a core snapshot and its private media ZIP.

Requires the snapshot SHA-256 from a separately retained recovery receipt.
Reads bytes only; never executes SQL, extracts files, or contacts the live system.
This proves snapshot/media completeness, not schema/Auth disaster restoration.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile

SHA = re.compile(r"[a-f0-9]{64}")
OBJECT = re.compile(r"(?:(?:originals|references|exports)/|incoming/[0-9a-f-]{36}/[0-9a-f-]{36}/)([0-9a-f]{64})")
MAX_DOCUMENT = 128 * 1024 * 1024
MAX_OBJECT = 35 * 1024 * 1024


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def positive_size(value):
    if type(value) is not int or not 0 < value <= MAX_OBJECT:
        raise ValueError("Invalid media size")
    return value


def read_snapshot(path, expected_sha):
    if not SHA.fullmatch(expected_sha):
        raise ValueError("Invalid receipt checksum")
    # Keep the same descriptor between hashing and decoding.
    with Path(path).open("rb") as raw:
        if hashlib.file_digest(raw, "sha256").hexdigest() != expected_sha:
            raise ValueError("Snapshot differs from recovery receipt")
        raw.seek(0)
        with gzip.GzipFile(fileobj=raw) as stream:
            data = stream.read(MAX_DOCUMENT + 1)
    if len(data) > MAX_DOCUMENT:
        raise ValueError("Snapshot exceeds offline verifier limit")
    doc = json.loads(data, object_pairs_hook=unique_object)
    if not isinstance(doc, dict) or type(doc.get("format")) is not int or doc["format"] != 1:
        raise ValueError("Unsupported snapshot format")
    tables = doc.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise ValueError("Snapshot tables missing")
    for table in tables.values():
        if not isinstance(table, dict):
            raise ValueError("Invalid table document")
        rows, layout, count = table.get("rows"), table.get("layout"), table.get("count")
        if not isinstance(rows, list) or type(count) is not int or count != len(rows):
            raise ValueError("Snapshot table count mismatch")
        if not isinstance(layout, list) or not layout:
            raise ValueError("Snapshot table layout missing")
        if any(not isinstance(col, list) or len(col) != 4 or not isinstance(col[0], str) for col in layout):
            raise ValueError("Invalid table layout")
        columns = {col[0] for col in layout}
        if len(columns) != len(layout) or any(not isinstance(row, dict) or set(row) != columns for row in rows):
            raise ValueError("Snapshot row/layout mismatch")
    return doc


def expected_media(doc):
    tables, expected = doc["tables"], {}
    if not {"photo_assets", "reference_assets", "photo_choices", "export_sets"} <= tables.keys():
        raise ValueError("Required media tables missing")

    def add(path, sha, size):
        match = OBJECT.fullmatch(path) if isinstance(path, str) else None
        if not match or match[1] != sha:
            raise ValueError("Invalid media path or content hash")
        size = positive_size(size)
        if path in expected and expected[path] != size:
            raise ValueError("Conflicting media references")
        expected[path] = size

    for name in ("photo_assets", "reference_assets"):
        for row in tables[name]["rows"]:
            if row["bucket"] != "studio-originals":
                raise ValueError("Unexpected media bucket")
            add(row["object_path"], row["sha256"], row["bytes"])
    for row in tables["photo_choices"]["rows"]:
        add("exports/" + row["choice"], row["choice"], row["image"]["bytes"])
    for row in tables["export_sets"]["rows"]:
        for image in row["images"]:
            add("exports/" + image["sha"], image["sha"], image["bytes"])
    return expected


def verify(snapshot, media, snapshot_sha):
    doc = read_snapshot(snapshot, snapshot_sha)
    expected = expected_media(doc)
    with ZipFile(media) as archive:
        entries = archive.infolist()
        sizes = {entry.filename: entry.file_size for entry in entries}
        if len(sizes) != len(entries):
            raise ValueError("Duplicate media archive entry")
        if any(sizes.get(path) != size for path, size in expected.items()):
            raise ValueError("Referenced media missing or size mismatch")
        # Verify extras too: a later archive may legitimately contain newer media.
        for entry in entries:
            match = OBJECT.fullmatch(entry.filename)
            if not match:
                raise ValueError("Invalid archive object path")
            size = positive_size(entry.file_size)
            checksum, count = hashlib.sha256(), 0
            with archive.open(entry) as stream:
                while block := stream.read(1024 * 1024):
                    count += len(block)
                    if count > size:
                        raise ValueError("Media exceeds recorded size")
                    checksum.update(block)
            if count != size or checksum.hexdigest() != match[1]:
                raise ValueError("Media content hash mismatch")
    manifest = "".join(f"{path}\t{sizes[path]}\n" for path in sorted(sizes))
    return {
        "snapshot_sha256": snapshot_sha,
        "snapshot_taken_at": doc.get("taken_at"),
        "tables_verified": len(doc["tables"]),
        "rows_verified": sum(t["count"] for t in doc["tables"].values()),
        "referenced_objects_verified": len(expected),
        "archive_objects_verified": len(sizes),
        "archive_bytes_verified": sum(sizes.values()),
        "additional_archive_objects": len(sizes.keys() - expected.keys()),
        "archive_manifest_sha256": hashlib.sha256(manifest.encode()).hexdigest(),
        "scope": "offline_snapshot_media_integrity_only",
        "schema_auth_restore_verified": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("media_zip", type=Path)
    parser.add_argument("snapshot_sha256", help="SHA-256 from separately retained recovery receipt")
    args = parser.parse_args()
    print(json.dumps(verify(args.snapshot, args.media_zip, args.snapshot_sha256), indent=2))
