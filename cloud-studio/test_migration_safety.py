import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent / "legacy"))
import listing_persistence as lp
from approval_policy import fingerprint
from approval_snapshots import init_schema, save_snapshot, read_snapshot
from restore_archive import restore


class SellerProtectionTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("CREATE TABLE groups(id TEXT PRIMARY KEY, fields TEXT, updated TEXT)")
        self.db.execute("INSERT INTO groups VALUES ('item', ?, 'original')", (json.dumps({"title": "Seller exact model", "price": "50", "description": "Seller copy"}),))
        self.db.commit()
        lp.protect_legacy_fields(self.db)

    def tearDown(self):
        self.db.close()

    def fields(self):
        return json.loads(self.db.execute("SELECT fields FROM groups WHERE id='item'").fetchone()[0])

    def save(self, updates, **kwargs):
        return lp.save_fields(self.db, "item", updates, source="seller", actor="test-owner", seller_action=True, **kwargs)

    def test_ai_cannot_overwrite_preserved_fields(self):
        result = lp.save_fields(self.db, "item", {"title": "Generic appliance", "description": "Internal research"}, source="ai", actor="test-worker")
        self.assertEqual(set(result["blocked_fields"]), {"title", "description"})
        self.assertEqual(self.fields()["title"], "Seller exact model")
        self.assertEqual(self.db.execute("SELECT count(*) FROM listing_field_proposals").fetchone()[0], 2)

    def test_stale_save_rejected_without_clobber(self):
        revision = lp.storage_revision(self.fields())
        self.save({"price": "75"}, expected_storage_revision=revision)
        with self.assertRaises(lp.ListingConflict):
            self.save({"title": "Stale edit"}, expected_storage_revision=revision)
        self.assertEqual(self.fields()["price"], "75")
        self.assertEqual(self.fields()["title"], "Seller exact model")

    def test_explicit_clear_survives_background_fill(self):
        self.save({"description": ""})
        lp.save_fields(self.db, "item", {"description": "Research fallback"}, source="ai", actor="worker", only_missing=True)
        self.assertEqual(self.fields()["description"], "")

    def test_rollback_appends_history(self):
        self.save({"price": "75"})
        event = self.db.execute("SELECT max(history_id) FROM listing_field_history WHERE field_name='price'").fetchone()[0]
        before = self.db.execute("SELECT count(*) FROM listing_field_history").fetchone()[0]
        lp.rollback_field(self.db, "item", "price", event, expected_storage_revision=lp.storage_revision(self.fields()))
        self.assertEqual(self.fields()["price"], "50")
        self.assertEqual(self.db.execute("SELECT count(*) FROM listing_field_history").fetchone()[0], before + 1)

    def test_direct_sql_cannot_bypass_seller_guard(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE groups SET fields='{}' WHERE id='item'")

    def test_unknown_history_not_relabelled_as_seller_authorship(self):
        sources = {r[0] for r in self.db.execute("SELECT source FROM listing_field_provenance")}
        self.assertEqual(sources, {"legacy_preserved_unknown"})


class ApprovalTests(unittest.TestCase):
    def test_revision_bound_immutable_snapshot(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE approvals(group_id TEXT PRIMARY KEY, fingerprint TEXT, approved_at TEXT)")
        init_schema(db)
        db.commit()
        group = {"id": "item", "fields": {"title": "Exact model", "price": "50", "description": "Seller copy", "condition": "New"}, "listing_photos": [{"kind": "real", "sha": "a" * 64}]}
        revision = fingerprint(group)
        db.execute("BEGIN")
        save_snapshot(db, group, revision)
        db.commit()
        self.assertEqual(read_snapshot(db, "item", revision)["title"], "Exact model")
        changed = copy.deepcopy(group)
        changed["fields"]["title"] = "Different model"
        self.assertNotEqual(fingerprint(changed), revision)
        db.execute("BEGIN")
        with self.assertRaises(ValueError):
            save_snapshot(db, changed, revision)
        db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("DELETE FROM approval_snapshots")


class ArchiveTests(unittest.TestCase):
    def test_tampered_archive_refused(self):
        record = {"kind": "sqlite_row", "source_key": "intake.sqlite3/groups/0", "content": "{}", "sha256": "0" * 64}
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                restore([record], folder)


if __name__ == "__main__":
    unittest.main()
