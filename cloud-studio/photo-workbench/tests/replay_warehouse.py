"""Replay the real archive through the same HTTP intake and worker used by the pilot."""

import argparse
import hashlib
import json
import random
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from zipfile import ZipFile

from studio.pipeline import load_catalog, run_worker
from studio.server import App
from studio.store import Store


def measure(batch, reference):
    by_name = {item["filename"]: item for item in reference["files"]}
    file_ids = {}
    for file in batch["files"]:
        row = by_name[file["name"]]
        if row["sha256"] != file["sha"]:
            raise ValueError("Archive does not match the reviewed photo bytes.")
        file_ids[file["id"]] = row["index"]
    expected = {frozenset(item["photos"]): item for item in reference["drafts"]}
    rows = []
    for draft in batch["drafts"]:
        members = sorted(file_ids[entry["id"]] for entry in draft["photos"])
        gallery = [file_ids[asset] for asset in draft["gallery"]]
        target = expected.get(frozenset(members))
        rows.append({
            "title": draft["title"],
            "source": draft["source"],
            "members": members,
            "gallery": gallery,
            "cover": file_ids.get(draft["cover"]),
            "reference": target["slug"] if target else None,
            "reference_cover": target["gallery"][0] if target else None,
            "identity": draft["identity"],
            "description": draft["description"],
            "price_cents": draft["price_cents"],
        })
    return {
        "state": batch["state"],
        "evaluation": batch["evaluation"],
        "accepted": sum(file["state"] == "accepted" for file in batch["files"]),
        "bytes_received": sum(file["offset"] for file in batch["files"]),
        "groups": len(rows),
        "exact_reference_groups": sum(row["reference"] is not None for row in rows),
        "reference_covers": sum(row["reference"] is not None and row["cover"] == row["reference_cover"]
                                for row in rows),
        "descriptions": sum(bool(row["description"]) for row in rows),
        "prices": sum(row["price_cents"] is not None for row in rows),
        "drafts": rows,
    }


def replay(archive, reference, catalog, target, shuffle, key=None):
    store = Store(target)
    stop = threading.Event()
    with App(("127.0.0.1", 0), store) as app, ZipFile(archive) as zipped:
        threading.Thread(target=app.serve_forever, daemon=True).start()
        worker = threading.Thread(target=run_worker, args=(store, catalog, stop), daemon=True)
        worker.start()

        def request(path, method="GET", data=None, headers=None):
            req = urllib.request.Request(f"http://127.0.0.1:{app.server_port}{path}",
                                         method=method, data=data, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)

        try:
            frames = sorted((entry for entry in zipped.infolist()
                             if not entry.is_dir() and Path(entry.filename).suffix.lower() in {".jpg", ".jpeg"}),
                            key=lambda entry: Path(entry.filename).name)
            if shuffle:
                random.Random(710).shuffle(frames)
            manifest = [{"name": Path(entry.filename).name, "size": entry.file_size,
                         "sha": hashlib.sha256(zipped.read(entry)).hexdigest()} for entry in frames]
            spec = json.dumps({"key": key or "warehouse-replay-" + str(shuffle), "files": manifest}).encode()
            receipt = request("/api/batches", "POST", spec)
            assert request("/api/batches", "POST", spec)["id"] == receipt["id"]
            endpoint = "/api/batches/" + receipt["id"]
            for index, (entry, file) in enumerate(zip(frames, receipt["files"], strict=True)):
                with zipped.open(entry) as photo:
                    offset = 0
                    while chunk := photo.read(1024**2):
                        url = endpoint + "/files/" + file["id"]
                        headers = {"Upload-Offset": str(offset)}
                        received = request(url, "PUT", chunk, headers)
                        if index == 0 and offset == 0:
                            assert request(url, "PUT", chunk, headers)["offset"] == received["offset"]
                        offset = received["offset"]
            print(f"Intake complete for {len(frames)} files.", flush=True)
            deadline = time.monotonic() + 1200
            while time.monotonic() < deadline:
                result = request(endpoint)
                if result["state"] in {"review", "failed"}:
                    return measure(result, reference)
                time.sleep(1.5)
            raise TimeoutError("The replay worker did not finish.")
        finally:
            stop.set()
            app.shutdown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--catalog", type=Path, default=Path("catalog/warehouse-reviewed.json"))
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--data", type=Path, help="Keep the replay batch in this isolated pilot data directory.")
    parser.add_argument("--key", help="Create a separate replay batch under a new upload key.")
    parser.add_argument("--shuffle", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="moe-replay-") as folder:
        result = replay(args.archive, json.loads(args.reference.read_text(encoding="utf-8")),
                        load_catalog(args.catalog), args.data or folder, args.shuffle, args.key)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print({key: value for key, value in result.items() if key != "drafts"})


if __name__ == "__main__":
    main()
