"""Append-only approval evidence. Call using the caller's approval transaction.
This module never approves a listing or changes the mutable approvals table.
"""
import datetime as dt
import hashlib
import hmac
import json
from approval_policy import public_payload

def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='microseconds')

def init_schema(db):
    # execute(), not executescript(): do not implicitly commit caller transactions.
    statements = [
        """CREATE TABLE IF NOT EXISTS approval_snapshots (
            snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            policy TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created TEXT NOT NULL,
            UNIQUE(group_id, fingerprint, policy))""",
        """CREATE TABLE IF NOT EXISTS approval_history (
            history_id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            preserved_at TEXT NOT NULL,
            event TEXT NOT NULL)""",
        """CREATE UNIQUE INDEX IF NOT EXISTS approval_history_initial
            ON approval_history(group_id,fingerprint,approved_at)
            WHERE event='existing-record-preserved'""",
        """CREATE TRIGGER IF NOT EXISTS approval_history_before_replace
            BEFORE UPDATE ON approvals
            BEGIN INSERT INTO approval_history
                (group_id,fingerprint,approved_at,preserved_at,event)
                VALUES (OLD.group_id,OLD.fingerprint,OLD.approved_at,
                        strftime('%Y-%m-%dT%H:%M:%fZ','now'),'replaced');
            END""",
        """CREATE TRIGGER IF NOT EXISTS approval_history_before_remove
            BEFORE DELETE ON approvals
            BEGIN INSERT INTO approval_history
                (group_id,fingerprint,approved_at,preserved_at,event)
                VALUES (OLD.group_id,OLD.fingerprint,OLD.approved_at,
                        strftime('%Y-%m-%dT%H:%M:%fZ','now'),'removed');
            END"""
    ]
    for sql in statements:
        db.execute(sql)
    for table in ('approval_snapshots', 'approval_history'):
        for action in ('UPDATE', 'DELETE'):
            db.execute(f"""CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()}
                BEFORE {action} ON {table}
                BEGIN SELECT RAISE(ABORT,'Approval evidence is append-only'); END""")
    # REPLACE conflict handling must not bypass append-only DELETE triggers.
    db.execute("""CREATE TRIGGER IF NOT EXISTS approval_snapshots_no_replace
        BEFORE INSERT ON approval_snapshots
        WHEN EXISTS (SELECT 1 FROM approval_snapshots WHERE snapshot_id=NEW.snapshot_id
            OR (group_id=NEW.group_id AND fingerprint=NEW.fingerprint AND policy=NEW.policy))
        BEGIN SELECT RAISE(ABORT,'Approval snapshot already exists'); END""")
    db.execute("""CREATE TRIGGER IF NOT EXISTS approval_history_no_replace
        BEFORE INSERT ON approval_history
        WHEN EXISTS (SELECT 1 FROM approval_history WHERE history_id=NEW.history_id
            OR (NEW.event='existing-record-preserved' AND event=NEW.event
                AND group_id=NEW.group_id AND fingerprint=NEW.fingerprint AND approved_at=NEW.approved_at))
        BEGIN SELECT RAISE(ABORT,'Approval history already exists'); END""")
    db.execute("""INSERT INTO approval_history
        (group_id,fingerprint,approved_at,preserved_at,event)
        SELECT a.group_id,a.fingerprint,a.approved_at,?,'existing-record-preserved'
        FROM approvals a WHERE NOT EXISTS (SELECT 1 FROM approval_history h
            WHERE h.event='existing-record-preserved' AND h.group_id=a.group_id
            AND h.fingerprint=a.fingerprint AND h.approved_at=a.approved_at)""", (_now(),))

def save_snapshot(db, group, expected_fingerprint):
    """Persist exactly the public payload reviewed, without committing or approving."""
    if not db.in_transaction:
        raise RuntimeError('Begin the approval transaction before saving its snapshot')
    payload = public_payload(group)
    serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    actual = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
    if not isinstance(expected_fingerprint,str) or not hmac.compare_digest(actual, expected_fingerprint):
        raise ValueError('Public listing changed before approval snapshot was saved')
    # A successful current approval may never silently reuse a different payload.
    old = db.execute("""SELECT snapshot_id,payload_json FROM approval_snapshots
        WHERE group_id=? AND fingerprint=? AND policy=?""",
        (group['id'],actual,payload['policy'])).fetchone()
    if old:
        if old[1] != serialized:
            raise ValueError('Existing approval snapshot conflicts with public payload')
        return old[0]
    cursor = db.execute("""INSERT INTO approval_snapshots
        (group_id,fingerprint,policy,payload_json,created) VALUES(?,?,?,?,?)""",
        (group['id'],actual,payload['policy'],serialized,_now()))
    return cursor.lastrowid


def load_snapshot(db, group_id, expected_fingerprint):
    """Return verified immutable public payload, or None. Never creates approval."""
    row = db.execute("""SELECT policy,payload_json FROM approval_snapshots
        WHERE group_id=? AND fingerprint=? ORDER BY snapshot_id DESC LIMIT 1""",
        (group_id,expected_fingerprint)).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row[1])
        serialized = json.dumps(payload,sort_keys=True,separators=(',', ':'),ensure_ascii=False)
        actual = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
        if (payload.get('group_id') != group_id or payload.get('policy') != row[0]
                or not hmac.compare_digest(actual,expected_fingerprint)):
            return None
        return payload
    except (ValueError,TypeError,AttributeError):
        return None


def read_snapshot(db, group_id, expected_fingerprint):
    payload = load_snapshot(db,group_id,expected_fingerprint)
    return payload if payload and payload.get('policy') == 'public-listing-v2' else None

def validate_queued_item(db, item, group):
    """Fail closed on stale, missing, or tampered queued listing contents."""
    if not isinstance(item,dict) or item.get('id') != group.get('id'):
        raise ValueError('Queued listing belongs to a different product')
    expected = item.get('public_revision') or item.get('revision') or ''
    if not isinstance(expected,str):
        raise ValueError('Queued public revision is invalid')
    payload = read_snapshot(db,group['id'],expected)
    if payload is None:
        raise ValueError('Immutable approval snapshot missing; review and prepare again')
    if item.get('approval_policy') != payload['policy']:
        raise ValueError('Queued approval policy is outdated')
    if public_payload(group) != payload:
        raise ValueError('Public listing changed since its approval snapshot')
    for key in ('title','description','condition','category'):
        if not isinstance(item.get(key),str) or item[key] != payload[key]:
            raise ValueError('Queued '+key+' differs from approved content')
    if 'price' not in item:
        raise ValueError('Queued price is missing')
    # Use the same normalized currency projection as approval hashing.
    queued_price = public_payload({'id':group['id'],'fields':{'price':item['price']}})['price']
    if queued_price != payload['price']:
        raise ValueError('Queued price differs from approved content')
    photos = item.get('photos')
    if not isinstance(photos,list) or len(photos) != len(payload['photos']):
        raise ValueError('Queued photo count differs from approved content')
    for index,(photo,approved) in enumerate(zip(photos,payload['photos'])):
        if not isinstance(photo,dict):
            raise ValueError('Queued photo is invalid')
        kind = 'manufacturer' if photo.get('kind') == 'stock' else photo.get('kind')
        expected_path = '/api/facebook-image/'+group['id']+'/'+str(index)
        if kind != approved['kind'] or photo.get('api_path') != expected_path:
            raise ValueError('Queued photo order or source differs from approved content')
    return payload
