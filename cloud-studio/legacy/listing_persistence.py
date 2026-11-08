"""Versioned listing writes. Legacy data is never relabelled as seller-authored.

Repository guards and SQLite triggers protect seller-owned fields. A scoped
transaction authorization enables explicit seller edits; it is not a security
boundary against privileged software deliberately disabling database protections.
"""
import datetime as dt
import hashlib
import json
import re


class ListingConflict(ValueError):
    pass


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def storage_revision(fields):
    return hashlib.sha256(encoded(fields).encode("utf-8")).hexdigest()


def read_fields(raw):
    value = json.loads(raw) if raw is not None else {}
    if not isinstance(value, dict):
        raise ValueError("Stored listing fields are not an object; recovery is required")
    return value


def ensure_schema(db):
    # No existing rows/columns are altered. Caller commits the migration.
    db.execute("""CREATE TABLE IF NOT EXISTS listing_write_audit (
        write_id INTEGER PRIMARY KEY, group_id TEXT NOT NULL,
        old_fields TEXT, new_fields TEXT NOT NULL, written_at TEXT NOT NULL)""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS listing_write_audit_insert
        AFTER INSERT ON groups BEGIN
        INSERT INTO listing_write_audit(group_id,old_fields,new_fields,written_at)
        VALUES(NEW.id,NULL,NEW.fields,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS listing_write_audit_update
        AFTER UPDATE OF fields ON groups WHEN OLD.fields IS NOT NEW.fields BEGIN
        INSERT INTO listing_write_audit(group_id,old_fields,new_fields,written_at)
        VALUES(NEW.id,OLD.fields,NEW.fields,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END""")
    db.execute("""CREATE TABLE IF NOT EXISTS listing_field_history (
        history_id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, field_name TEXT NOT NULL,
        old_value TEXT, new_value TEXT NOT NULL, old_present INTEGER NOT NULL,
        source TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
        before_revision TEXT NOT NULL, after_revision TEXT NOT NULL,
        created_at TEXT NOT NULL)""")
    db.execute("""CREATE INDEX IF NOT EXISTS listing_history_group_field
        ON listing_field_history(group_id,field_name,history_id)""")
    db.execute("""CREATE TABLE IF NOT EXISTS listing_field_provenance (
        group_id TEXT NOT NULL, field_name TEXT NOT NULL, source TEXT NOT NULL,
        actor TEXT NOT NULL, seller_owned INTEGER NOT NULL, value_hash TEXT NOT NULL,
        history_id INTEGER NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(group_id,field_name))""")
    db.execute("""CREATE TABLE IF NOT EXISTS listing_field_proposals (
        proposal_id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, field_name TEXT NOT NULL,
        proposed_value TEXT NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL,
        based_on_revision TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL)""")


    db.execute("""CREATE TABLE IF NOT EXISTS listing_write_authorization (
        group_id TEXT PRIMARY KEY)""")
    changed = """EXISTS (SELECT 1 FROM listing_field_provenance p
        WHERE p.group_id=NEW.id AND p.seller_owned=1 AND (
        json_extract((SELECT fields FROM groups WHERE id=NEW.id),'$.'||p.field_name)
            IS NOT json_extract(NEW.fields,'$.'||p.field_name) OR
        json_type((SELECT fields FROM groups WHERE id=NEW.id),'$.'||p.field_name)
            IS NOT json_type(NEW.fields,'$.'||p.field_name)))"""
    # INSERT covers INSERT OR REPLACE as well as normal UPSERT paths. Merely
    # updating an unrelated field is allowed and still audited.
    for operation, name in (("INSERT", "insert"), ("UPDATE OF fields", "update")):
        db.execute("CREATE TRIGGER IF NOT EXISTS listing_seller_guard_"+name+
            " BEFORE "+operation+" ON groups WHEN NOT EXISTS "
            "(SELECT 1 FROM listing_write_authorization WHERE group_id=NEW.id) AND "+changed+
            " BEGIN SELECT RAISE(ABORT,'Seller-owned field requires an explicit listing-editor action'); END")
    db.execute("""CREATE TRIGGER IF NOT EXISTS listing_seller_guard_delete
        BEFORE DELETE ON groups WHEN EXISTS(SELECT 1 FROM listing_field_provenance
        WHERE group_id=OLD.id AND seller_owned=1) AND NOT EXISTS
        (SELECT 1 FROM listing_write_authorization WHERE group_id=OLD.id)
        BEGIN SELECT RAISE(ABORT,'Seller-owned listing cannot be deleted outside the listing editor'); END""")


def provenance_for(db):
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = {}
    if "listing_field_provenance" not in tables:
        return result
    for row in db.execute("SELECT group_id,field_name,source,actor,seller_owned,value_hash,history_id,updated_at FROM listing_field_provenance"):
        gid, field, source, actor, owned, value_hash, history_id, updated = row
        result.setdefault(gid, {})[field] = dict(source=source, actor=actor,
            seller_owned=bool(owned), value_hash=value_hash, history_id=history_id, updated_at=updated)
    return result


def save_fields(db, group_id, updates, *, effective_fields=None, source,
                actor, seller_action=False, expected_storage_revision=None,
                expected_fields=None, only_missing=False, reason="", validate=None):
    """Perform a short transaction on a fresh connection, merging only edited keys.

    effective_fields is a rendered fallback used solely for field preconditions
    and missing-field detection. It is NEVER persisted with unrelated edits.
    A seller action identifies the user-facing edit/import route, never a worker.
    """
    if db.in_transaction:
        raise RuntimeError("Listing save requires its own transaction")
    if not isinstance(updates, dict) or not isinstance(source, str) or not source or not actor:
        raise ValueError("Invalid listing write")
    if expected_storage_revision is not None and (
        not isinstance(expected_storage_revision, str) or
        not re.fullmatch(r"[a-f0-9]{64}", expected_storage_revision)
    ):
        raise ValueError("Invalid storage revision")
    if expected_fields is not None and (not isinstance(expected_fields, dict) or
        set(expected_fields) != set(updates)):
        raise ValueError("Invalid field preconditions")
    db.execute("BEGIN IMMEDIATE")
    try:
        ensure_schema(db)
        row = db.execute("SELECT fields FROM groups WHERE id=?", (group_id,)).fetchone()
        stored = read_fields(row[0]) if row else {}
        before = storage_revision(stored)
        if expected_storage_revision is not None and before != expected_storage_revision:
            raise ListingConflict("Listing changed in another process; refresh before saving")
        effective = {**stored, **(effective_fields or {})}
        if expected_fields is not None:
            changed = [k for k, value in expected_fields.items() if effective.get(k, "") != value]
            if changed:
                raise ListingConflict("Listing changed elsewhere: " + ", ".join(sorted(changed)))
        if validate is not None:
            validate(stored)
        metadata = {r[0]: (bool(r[1]), r[2]) for r in db.execute(
            "SELECT field_name,seller_owned,value_hash FROM listing_field_provenance WHERE group_id=?", (group_id,))}
        accepted, blocked = {}, []
        at = dt.datetime.now(dt.timezone.utc).isoformat()
        for field, value in updates.items():
            if not seller_action or source == "retailer_import":
                if field in ("notes","condition"):
                    blocked.append(field)
                    continue
                if field in ("title","description"):
                    from listing_public_copy import clean
                    value = clean(value,field)
            owned = metadata.get(field, (False, ""))[0]
            # An explicit seller clear is protected, including from fill-missing jobs.
            if owned and not seller_action:
                db.execute("""INSERT INTO listing_field_proposals
                    (group_id,field_name,proposed_value,source,actor,based_on_revision,reason,created_at)
                    VALUES(?,?,?,?,?,?,?,?)""", (group_id, field, encoded(value), source,
                    actor, before, "Seller-owned field preserved. " + reason, at))
                blocked.append(field)
                continue
            if only_missing and effective.get(field) not in (None, "", []):
                continue
            # Saving an unchanged field can establish explicit seller ownership.
            if field not in stored or stored[field] != value or (seller_action and not owned):
                accepted[field] = value
        merged = {**stored, **accepted}
        after = storage_revision(merged)
        if seller_action:
            db.execute("INSERT INTO listing_write_authorization(group_id) VALUES(?)", (group_id,))
        if merged != stored or row is None and accepted:
            db.execute("""INSERT INTO groups(id,fields,updated) VALUES(?,?,?)
                ON CONFLICT(id) DO UPDATE SET fields=excluded.fields,updated=excluded.updated""",
                (group_id, encoded(merged), at))
        for field, value in accepted.items():
            cur = db.execute("""INSERT INTO listing_field_history
                (group_id,field_name,old_value,new_value,old_present,source,actor,reason,
                 before_revision,after_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (group_id, field, encoded(stored[field]) if field in stored else None,
                 encoded(value), int(field in stored), source, actor, reason, before, after, at))
            old_owned = metadata.get(field, (False, ""))[0]
            db.execute("""INSERT INTO listing_field_provenance
                (group_id,field_name,source,actor,seller_owned,value_hash,history_id,updated_at)
                VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(group_id,field_name) DO UPDATE SET
                source=excluded.source,actor=excluded.actor,seller_owned=excluded.seller_owned,
                value_hash=excluded.value_hash,history_id=excluded.history_id,updated_at=excluded.updated_at""",
                (group_id, field, source, actor, int(seller_action or old_owned),
                 storage_revision({field: value}), cur.lastrowid, at))
        if seller_action:
            db.execute("DELETE FROM listing_write_authorization WHERE group_id=?", (group_id,))
        db.commit()
        return {"updated": list(accepted), "blocked_fields": blocked,
                "storage_revision": after, "fields": merged}
    except Exception:
        db.rollback()
        raise


def rollback_field(db, group_id, field_name, history_id, *, expected_storage_revision):
    """Explicit seller action restores a previous value; original absence clears it.

    Absence is restored as an explicit empty value so catalog fallback cannot
    silently resurrect a field the seller has chosen to clear.
    """
    row = db.execute("""SELECT old_value,old_present FROM listing_field_history
        WHERE history_id=? AND group_id=? AND field_name=?""",
        (history_id, group_id, field_name)).fetchone()
    if row is None:
        raise ValueError("Field history not found")
    value = json.loads(row[0]) if row[1] else ""
    return save_fields(db, group_id, {field_name: value}, source="seller_rollback",
        actor="owner_rollback", seller_action=True,
        expected_storage_revision=expected_storage_revision,
        reason="Restore value before history " + str(history_id))


def protect_legacy_fields(db):
    """Preserve historical saved values without inventing seller provenance.

    The protection flag means owner-controlled, not proof of authorship. Existing
    metadata is retained. All original groups.fields bytes/timestamps stay intact.
    Run explicitly after a verified backup; never as a side effect of a read.
    """
    if db.in_transaction:
        raise RuntimeError('Baseline protection requires its own transaction')
    db.execute('BEGIN IMMEDIATE')
    try:
        ensure_schema(db)
        at = dt.datetime.now(dt.timezone.utc).isoformat()
        groups, protected, existing = 0, 0, 0
        for gid, raw in db.execute('SELECT id,fields FROM groups').fetchall():
            fields = read_fields(raw)
            groups += 1
            rev = storage_revision(fields)
            for field, value in fields.items():
                if db.execute('SELECT 1 FROM listing_field_provenance WHERE group_id=? AND field_name=?', (gid,field)).fetchone():
                    existing += 1
                    continue
                cur = db.execute('''INSERT INTO listing_field_history
                    (group_id,field_name,old_value,new_value,old_present,source,actor,reason,
                     before_revision,after_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                    (gid, field, encoded(value), encoded(value), 1, 'legacy_preserved_unknown',
                     'baseline_preservation', 'Historical authorship unknown; preserve saved value without asserting seller authorship',
                     rev, rev, at))
                db.execute('''INSERT INTO listing_field_provenance
                    (group_id,field_name,source,actor,seller_owned,value_hash,history_id,updated_at)
                    VALUES(?,?,?,?,?,?,?,?)''',
                    (gid, field, 'legacy_preserved_unknown', 'baseline_preservation', 1,
                     storage_revision({field:value}), cur.lastrowid, at))
                protected += 1
        db.commit()
        return {'groups_seen':groups,'fields_protected':protected,'fields_already_tracked':existing,
                'source':'legacy_preserved_unknown','raw_values_changed':0}
    except Exception:
        db.rollback()
        raise
