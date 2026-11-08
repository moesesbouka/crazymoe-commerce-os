import copy
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import warnings
from zipfile import ZipFile

from verify_bundle import verify


def table(rows, names):
    return {"rows": rows, "count": len(rows), "layout": [[n, "text", False, ""] for n in names]}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.body = b"synthetic original bytes"
        self.sha = hashlib.sha256(self.body).hexdigest()
        self.path = "originals/" + self.sha
        self.export = b"synthetic exported bytes"
        self.export_sha = hashlib.sha256(self.export).hexdigest()
        self.assets = {self.path: self.body, "exports/" + self.export_sha: self.export}
        row = {"bucket": "studio-originals", "object_path": self.path, "sha256": self.sha,
               "bytes": len(self.body), "cloud_verified_at": "2026-11-06"}
        self.doc = {"format": 1, "taken_at": "2026-11-06", "tables": {
            "photo_assets": table([row], row.keys()),
            "reference_assets": table([], row.keys()),
            "photo_choices": table([{"choice": self.export_sha, "image": {"bytes": len(self.export)}}], ["choice", "image"]),
            "export_sets": table([{"images": [{"sha": self.export_sha, "bytes": len(self.export)}]}], ["images"]),
        }}

    def run_bundle(self, doc=None, assets=None, checksum=None, raw_json=None, duplicate=False):
        raw = raw_json or json.dumps(self.doc if doc is None else doc).encode()
        snapshot = self.root / "core.gz"
        snapshot.write_bytes(gzip.compress(raw))
        archive = self.root / "media.zip"
        with ZipFile(archive, "w") as z:
            for key, value in (self.assets if assets is None else assets).items():
                z.writestr(key, value)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    z.writestr(self.path, self.body)
        return verify(snapshot, archive, checksum or hashlib.sha256(snapshot.read_bytes()).hexdigest())

    def test_snapshot_and_every_referenced_byte(self):
        result = self.run_bundle()
        self.assertEqual(result["referenced_objects_verified"], 2)
        self.assertEqual(result["rows_verified"], 3)
        self.assertFalse(result["schema_auth_restore_verified"])

    def test_missing_media(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            self.run_bundle(assets={self.path: self.body})

    def test_same_size_corruption(self):
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.run_bundle(assets={**self.assets, self.path: b"x" * len(self.body)})

    def test_wrong_receipt(self):
        with self.assertRaisesRegex(ValueError, "receipt"):
            self.run_bundle(checksum="0" * 64)

    def test_corrupted_extra_rejected(self):
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.run_bundle(assets={**self.assets, "references/" + "1" * 64: b"extra"})

    def test_valid_extra_reported(self):
        data = b"newer photo"
        result = self.run_bundle(assets={**self.assets, "references/" + hashlib.sha256(data).hexdigest(): data})
        self.assertEqual(result["additional_archive_objects"], 1)

    def test_duplicate_zip_entry(self):
        with self.assertRaisesRegex(ValueError, "Duplicate media"):
            self.run_bundle(duplicate=True)

    def test_traversal_entry_rejected(self):
        with self.assertRaisesRegex(ValueError, "archive object path"):
            self.run_bundle(assets={**self.assets, "../escape": b"x"})
        self.assertFalse((self.root.parent / "escape").exists())

    def test_wrong_table_count(self):
        doc = copy.deepcopy(self.doc)
        doc["tables"]["photo_assets"]["count"] += 1
        with self.assertRaisesRegex(ValueError, "table count"):
            self.run_bundle(doc=doc)

    def test_wrong_row_layout(self):
        doc = copy.deepcopy(self.doc)
        del doc["tables"]["photo_assets"]["rows"][0]["bytes"]
        with self.assertRaisesRegex(ValueError, "row/layout"):
            self.run_bundle(doc=doc)

    def test_conflicting_references(self):
        doc = copy.deepcopy(self.doc)
        doc["tables"]["export_sets"]["rows"][0]["images"][0]["bytes"] += 1
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.run_bundle(doc=doc)

    def test_missing_media_table(self):
        doc = copy.deepcopy(self.doc)
        del doc["tables"]["export_sets"]
        with self.assertRaisesRegex(ValueError, "Required media"):
            self.run_bundle(doc=doc)

    def test_unverified_asset_still_required(self):
        doc = copy.deepcopy(self.doc)
        doc["tables"]["photo_assets"]["rows"][0]["cloud_verified_at"] = None
        with self.assertRaisesRegex(ValueError, "missing"):
            self.run_bundle(doc=doc, assets={})

    def test_duplicate_json_key(self):
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            self.run_bundle(raw_json=b'{"format":1,"format":1}')


if __name__ == "__main__":
    unittest.main()
