import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class RequestError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def new_id():
    return uuid.uuid4().hex


SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, created REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'receiving', issue TEXT, evaluation TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), name TEXT NOT NULL,
  size INTEGER NOT NULL, offset INTEGER NOT NULL DEFAULT 0, ordinal INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', expected_sha TEXT NOT NULL, sha TEXT, issue TEXT, UNIQUE(batch_id, ordinal)
);
CREATE TABLE IF NOT EXISTS single_item_batches (
  batch_id TEXT PRIMARY KEY REFERENCES batches(id)
);
CREATE TABLE IF NOT EXISTS jobs (
  batch_id TEXT PRIMARY KEY REFERENCES batches(id), state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_at REAL NOT NULL DEFAULT 0, lease TEXT, expires REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS refresh_plans (
  batch_id TEXT PRIMARY KEY REFERENCES batches(id), drafts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), revision INTEGER NOT NULL DEFAULT 1,
  fields TEXT NOT NULL, approval INTEGER
);
CREATE TABLE IF NOT EXISTS revisions (
  draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(draft_id,revision)
);
CREATE TABLE IF NOT EXISTS handoffs (
  draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL,
  channel TEXT NOT NULL, created REAL NOT NULL, PRIMARY KEY(draft_id,revision,channel)
);
"""


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        for child in ("uploads", "renders"):
            (self.root / child).mkdir(mode=0o700, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.root / "studio.sqlite3", timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create(self, key, manifest, single_item=False):
        if type(single_item) is not bool:
            raise RequestError("Choose one product or a mixed batch.")
        if not isinstance(key, str) or not 16 <= len(key) <= 100:
            raise RequestError("Invalid upload key.")
        if not isinstance(manifest, list) or not 1 <= len(manifest) <= 100:
            raise RequestError("Select between 1 and 100 photos per batch.")
        if any(not isinstance(f, dict) or not isinstance(f.get("name"), str) or not 1 <= len(f["name"]) <= 255
               or type(f.get("size")) is not int or not 1 <= f["size"] <= 24 * 1024**2
               or not isinstance(f.get("sha"), str) or not re.fullmatch(r"[a-f0-9]{64}", f["sha"])
               for f in manifest):
            raise RequestError("Each photo must have an integrity receipt and be 24 MB or smaller.")
        with self.connection(write=True) as db:
            previous = db.execute("SELECT id FROM batches WHERE request_key=?", (key,)).fetchone()
            if previous:
                batch = previous["id"]
                old = db.execute("SELECT name,size,expected_sha FROM files WHERE batch_id=? ORDER BY ordinal", (batch,))
                if ([tuple(x) for x in old] != [(f["name"], f["size"], f["sha"]) for f in manifest]
                        or self._single_item(db, batch) != single_item):
                    raise RequestError("This upload key already belongs to a different set of photos.", 409)
                return batch
            batch = new_id()
            db.execute("INSERT INTO batches(id,request_key,created) VALUES(?,?,?)", (batch, key, time.time()))
            if single_item:
                db.execute("INSERT INTO single_item_batches VALUES(?)", (batch,))
            db.executemany("INSERT INTO files(id,batch_id,name,size,ordinal,expected_sha) VALUES(?,?,?,?,?,?)",
                           [(new_id(), batch, f["name"], f["size"], i, f["sha"]) for i, f in enumerate(manifest)])
        return batch

    @staticmethod
    def _single_item(db, batch):
        return db.execute("SELECT 1 FROM single_item_batches WHERE batch_id=?", (batch,)).fetchone() is not None

    def single_item(self, batch):
        with self.connection() as db:
            return self._single_item(db, batch)

    def put(self, batch, file_id, offset, content, inspect):
        with self.connection(write=True) as db:
            row = db.execute("SELECT * FROM files WHERE id=? AND batch_id=?", (file_id, batch)).fetchone()
            if not row:
                raise RequestError("Photo not found.", 404)
            if offset < 0 or offset + len(content) > row["size"]:
                raise RequestError("Invalid photo byte range.")
            path = self.root / "uploads" / file_id
            if row["state"] == "skipped":
                raise RequestError("This batch was already committed without that photo.", 409)
            if offset > row["offset"] or offset < row["offset"] < offset + len(content):
                raise RequestError("Photo offset changed. Refresh the upload receipt.", 409)
            if offset < row["offset"] or row["state"] != "pending":
                # A client can retry after losing a receipt. Accept only identical bytes.
                with path.open("rb") as saved:
                    saved.seek(offset)
                    if saved.read(len(content)) != content:
                        raise RequestError("Retry bytes do not match the accepted photo.", 409)
                return {"offset": row["offset"], "state": row["state"]}
            with path.open("r+b" if path.exists() else "w+b") as output:
                output.seek(offset)
                output.write(content)
                output.truncate()
                output.flush()
                os.fsync(output.fileno())
            received = offset + len(content)
            state, issue, digest = "pending", None, None
            if received == row["size"]:
                try:
                    inspect(path)
                    with path.open("rb") as source:
                        digest = hashlib.file_digest(source, "sha256").hexdigest()
                    if digest != row["expected_sha"]:
                        raise ValueError("Uploaded bytes did not match the selected photo's integrity receipt.")
                    state = "duplicate" if db.execute(
                        "SELECT 1 FROM files WHERE batch_id=? AND sha=? AND state='accepted'", (batch, digest)
                    ).fetchone() else "accepted"
                except ValueError as error:
                    state, issue = "rejected", str(error)
            db.execute("UPDATE files SET offset=?,state=?,sha=?,issue=? WHERE id=?",
                       (received, state, digest, issue, file_id))
            if received == row["size"] and not db.execute(
                    "SELECT 1 FROM files WHERE batch_id=? AND state='pending'", (batch,)).fetchone():
                if db.execute("SELECT 1 FROM files WHERE batch_id=? AND state='accepted'", (batch,)).fetchone():
                    self.enqueue(db, batch)
                else:
                    db.execute("UPDATE batches SET state='failed',issue='No photo passed intake checks.' WHERE id=?", (batch,))
            return {"offset": received, "state": state, "issue": issue}

    @staticmethod
    def enqueue(db, batch):
        db.execute("UPDATE batches SET state='queued' WHERE id=?", (batch,))
        db.execute("INSERT OR IGNORE INTO jobs(batch_id,state) VALUES(?,'queued')", (batch,))

    def commit_batch(self, batch):
        with self.connection(write=True) as db:
            current = db.execute("SELECT state FROM batches WHERE id=?", (batch,)).fetchone()
            if not current:
                raise RequestError("Batch not found.", 404)
            if current["state"] != "receiving":
                return
            if db.execute("SELECT 1 FROM files WHERE batch_id=? AND state='pending'", (batch,)).fetchone():
                raise RequestError("Finish uploading the remaining photos. The received files are saved.", 409)
            if not db.execute("SELECT 1 FROM files WHERE batch_id=? AND state='accepted'", (batch,)).fetchone():
                raise RequestError("This batch has no valid photos to process.", 422)
            self.enqueue(db, batch)

    def claim(self):
        now = time.time()
        with self.connection(write=True) as db:
            db.execute("""UPDATE batches SET state='failed',issue='Processing stopped after its final attempt.'
                          WHERE id IN (SELECT batch_id FROM jobs WHERE state='running' AND expires<=? AND attempts>=3)""", (now,))
            db.execute("UPDATE jobs SET state='failed' WHERE state='running' AND expires<=? AND attempts>=3", (now,))
            row = db.execute("""SELECT * FROM jobs WHERE attempts<3 AND
                ((state='queued' AND next_at<=?) OR (state='running' AND expires<=?)) ORDER BY next_at,batch_id LIMIT 1""",
                (now, now)).fetchone()
            if not row:
                return None
            lease = new_id()
            batch = row["batch_id"]
            db.execute("UPDATE jobs SET state='running',lease=?,expires=?,attempts=attempts+1 WHERE batch_id=?",
                       (lease, now + 900, batch))
            db.execute("UPDATE batches SET state='processing',issue=NULL WHERE id=?", (batch,))
            files = db.execute("SELECT * FROM files WHERE batch_id=? AND state='accepted' ORDER BY ordinal", (batch,)).fetchall()
            return batch, lease, files

    def finish(self, batch, lease, drafts, evaluation="", error=None):
        with self.connection(write=True) as db:
            job = db.execute("SELECT * FROM jobs WHERE batch_id=? AND state='running' AND lease=?", (batch, lease)).fetchone()
            if not job:
                return
            if error:
                retry = job["attempts"] < 3
                db.execute("UPDATE jobs SET state=?, next_at=? WHERE batch_id=?",
                           ("queued" if retry else "failed", time.time() + 2 ** job["attempts"], batch))
                db.execute("UPDATE batches SET state=?,issue=? WHERE id=?", ("queued" if retry else "failed", error, batch))
                return
            if plan := db.execute("SELECT drafts FROM refresh_plans WHERE batch_id=?", (batch,)).fetchone():
                versions = json.loads(plan["drafts"])
                for draft in drafts:
                    ident = draft.pop("refresh_id")
                    version = versions[ident] + 1
                    snapshot = json.dumps(draft)
                    changed = db.execute(
                        "UPDATE drafts SET fields=?,revision=? WHERE id=? AND revision=? AND approval IS NULL",
                        (snapshot, version, ident, version - 1))
                    if changed.rowcount:
                        db.execute("INSERT INTO revisions VALUES(?,?,?,?)", (ident, version, snapshot, time.time()))
                db.execute("DELETE FROM refresh_plans WHERE batch_id=?", (batch,))
            else:
                for draft in drafts:
                    ident = new_id()
                    snapshot = json.dumps(draft)
                    db.execute("INSERT INTO drafts(id,batch_id,fields) VALUES(?,?,?)", (ident, batch, snapshot))
                    db.execute("INSERT INTO revisions VALUES(?,?,?,?)", (ident, 1, snapshot, time.time()))
            db.execute("UPDATE jobs SET state='done' WHERE batch_id=?", (batch,))
            db.execute("UPDATE batches SET state='review',evaluation=?,issue=NULL WHERE id=?", (evaluation, batch))

    def progress(self, batch, lease, message):
        with self.connection(write=True) as db:
            renewed = db.execute("UPDATE jobs SET expires=? WHERE batch_id=? AND state='running' AND lease=?",
                                 (time.time() + 900, batch, lease))
            if renewed.rowcount:
                db.execute("UPDATE batches SET issue=? WHERE id=? AND state='processing'", (message, batch))

    def retry(self, batch):
        with self.connection(write=True) as db:
            changed = db.execute("UPDATE jobs SET state='queued',attempts=0,next_at=0,lease=NULL WHERE batch_id=? AND state='failed'", (batch,))
            if not changed.rowcount:
                raise RequestError("Only a failed batch can be retried.", 409)
            db.execute("UPDATE batches SET state='queued',issue=NULL WHERE id=?", (batch,))

    def refresh(self, batch):
        with self.connection(write=True) as db:
            row = db.execute("SELECT state FROM batches WHERE id=?", (batch,)).fetchone()
            if not row:
                raise RequestError("Batch not found.", 404)
            if db.execute("SELECT 1 FROM refresh_plans WHERE batch_id=?", (batch,)).fetchone():
                if row["state"] in ("queued", "processing"):
                    return
                raise RequestError("Retry the existing identifier job first.", 409)
            if row["state"] != "review":
                raise RequestError("Wait for the current upload or processing to finish.", 409)
            versions = {draft["id"]: draft["revision"] for draft in db.execute("""
                SELECT id,revision FROM drafts d WHERE batch_id=? AND approval IS NULL
                AND COALESCE(json_extract(fields,'$.merged'),0)=0
                AND NOT EXISTS (SELECT 1 FROM handoffs WHERE draft_id=d.id)
                """, (batch,))}
            if not versions:
                raise RequestError("There are no eligible unapproved drafts in this batch.", 409)
            db.execute("INSERT INTO refresh_plans VALUES(?,?)", (batch, json.dumps(versions)))
            db.execute("UPDATE jobs SET state='queued',attempts=0,next_at=0,lease=NULL WHERE batch_id=?", (batch,))
            db.execute("UPDATE batches SET state='queued',issue=NULL WHERE id=?", (batch,))

    def refresh_inputs(self, batch):
        with self.connection() as db:
            plan = db.execute("SELECT drafts FROM refresh_plans WHERE batch_id=?", (batch,)).fetchone()
            if plan is None:
                return None
            inputs = []
            for ident, revision in json.loads(plan["drafts"]).items():
                row = db.execute("""SELECT d.fields,r.snapshot FROM drafts d
                    JOIN revisions r ON r.draft_id=d.id AND r.revision=1
                    WHERE d.id=? AND d.revision=? AND d.approval IS NULL""", (ident, revision)).fetchone()
                if row:
                    inputs.append((ident, json.loads(row["fields"]), json.loads(row["snapshot"])))
            return inputs

    def reference_drafts(self):
        with self.connection() as db:
            return [json.loads(row["fields"]) for row in db.execute("""SELECT fields FROM drafts
                WHERE approval=revision AND json_extract(fields,'$.cover') IS NOT NULL
                AND json_array_length(json_extract(fields,'$.identity_sources'))>0
                ORDER BY rowid DESC LIMIT 24""")]

    @staticmethod
    def draft_row(row):
        return {"id": row["id"], "batch": row["batch_id"], "revision": row["revision"],
                "approval": row["approval"], **json.loads(row["fields"])}

    def batch(self, batch):
        with self.connection() as db:
            row = db.execute("SELECT id,created,state,issue,evaluation FROM batches WHERE id=?", (batch,)).fetchone()
            if not row:
                raise RequestError("Batch not found.", 404)
            files = db.execute("SELECT id,name,size,offset,state,issue,expected_sha sha FROM files WHERE batch_id=? ORDER BY ordinal", (batch,))
            drafts = db.execute("SELECT * FROM drafts WHERE batch_id=? ORDER BY rowid", (batch,))
            return {**dict(row), "single_item": self._single_item(db, batch),
                    "files": [dict(f) for f in files], "drafts": [self.draft_row(f) for f in drafts]}

    def batches(self):
        with self.connection() as db:
            result = db.execute("""SELECT b.id,b.state,b.created,count(f.id) photos FROM batches b
                                    LEFT JOIN files f ON f.batch_id=b.id GROUP BY b.id ORDER BY b.created DESC""")
            return [dict(f) for f in result]

    def draft(self, ident):
        with self.connection() as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row:
                raise RequestError("Draft not found.", 404)
            return self.draft_row(row)

    def edit(self, ident, revision, changes, issues):
        with self.connection(write=True) as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row:
                raise RequestError("Draft not found.", 404)
            if row["revision"] != revision:
                raise RequestError("This draft changed. Reload it before saving.", 409)
            fields = {**json.loads(row["fields"]), **changes}
            fields["issues"] = issues(fields)
            snapshot = json.dumps(fields)
            db.execute("UPDATE drafts SET fields=?,revision=revision+1,approval=NULL WHERE id=?", (snapshot, ident))
            db.execute("INSERT INTO revisions VALUES(?,?,?,?)", (ident, revision + 1, snapshot, time.time()))
        return self.draft(ident)

    def approve(self, ident, revision):
        with self.connection(write=True) as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row or row["revision"] != revision:
                raise RequestError("The draft revision changed. Reload it before approving.", 409)
            if json.loads(row["fields"])["issues"]:
                raise RequestError("Resolve the draft checks before approving.", 422)
            db.execute("UPDATE drafts SET approval=? WHERE id=?", (revision, ident))

    def transfer(self, ident, revision, photo_id, destination, destination_revision, checks):
        with self.connection(write=True) as db:
            origin = db.execute("SELECT * FROM drafts WHERE id=?", (ident,)).fetchone()
            target = db.execute("SELECT * FROM drafts WHERE id=?", (destination,)).fetchone() if destination else None
            if not origin or origin["revision"] != revision or (destination and
                    (not target or target["id"] == ident or target["batch_id"] != origin["batch_id"]
                     or target["revision"] != destination_revision)):
                raise RequestError("The drafts changed. Refresh before moving the photo.", 409)
            before = json.loads(origin["fields"])
            moving = [p for p in before["photos"] if p["id"] == photo_id]
            if len(moving) != 1:
                raise RequestError("Photo does not belong to this group.", 409)
            if len(before["photos"]) == 1 and not target:
                raise RequestError("This photo already has its own draft.", 409)
            after = json.loads(target["fields"]) if target else {
                **before, "title": "", "description": "", "gallery": [], "photos": [],
                "price_cents": None, "price_override": False,
                "condition_confirmed": False, "cover": None
            }
            if photo_id in before["gallery"]:
                after["gallery"].append(photo_id)
                before["gallery"].remove(photo_id)
            after["photos"].extend(moving)
            before["photos"] = [p for p in before["photos"] if p["id"] != photo_id]
            for fields in (before, after):
                if fields["cover"] not in fields["gallery"]:
                    fields["cover"] = next(iter(fields["gallery"]), None)
                fields.update(uncertain=True, photo_reviewed=False, identity="Variant unconfirmed", specs={})
                if not fields["price_override"]:
                    fields.update(price_cents=None, price={"basis": "Grouping changed", "sources": [], "cents": None})
                fields["issues"] = checks(fields)
            if not before["photos"]:
                before["merged"] = True
            for row, fields in [(origin, before), (target, after)]:
                snapshot = json.dumps(fields)
                if row:
                    draft_id, version = row["id"], row["revision"] + 1
                    db.execute("UPDATE drafts SET fields=?,revision=?,approval=NULL WHERE id=?", (snapshot, version, draft_id))
                else:
                    draft_id, version = new_id(), 1
                    db.execute("INSERT INTO drafts(id,batch_id,fields) VALUES(?,?,?)", (draft_id, origin["batch_id"], snapshot))
                db.execute("INSERT INTO revisions VALUES(?,?,?,?)", (draft_id, version, snapshot, time.time()))

    def record_handoff(self, ident, revision, channel):
        with self.connection(write=True) as db:
            row = db.execute("SELECT revision,approval FROM drafts WHERE id=?", (ident,)).fetchone()
            if not row or row["revision"] != revision or row["approval"] != revision:
                raise RequestError("Approve this exact draft revision before exporting.", 409)
            db.execute("INSERT OR IGNORE INTO handoffs VALUES(?,?,?,?)", (ident, revision, channel, time.time()))
