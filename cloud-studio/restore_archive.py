"""Restore private migration rows into NEW SQLite files for recovery verification.

Input is a JSON array exported from studio_migration.records. Never use on a
live database. No credentials, seller data or restored databases belong in Git.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sqlite3


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def restore(records, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    by_database = {}
    seen = set()
    for record in records:
        if record["kind"] not in ("sqlite_schema", "sqlite_row"):
            continue
        identity = (record["kind"], record["source_key"])
        if identity in seen:
            raise ValueError("Duplicate archive key")
        seen.add(identity)
        if hashlib.sha256(record["content"].encode()).hexdigest() != record["sha256"]:
            raise ValueError("Archive content hash mismatch")
        database, key = record["source_key"].split("/", 1)
        if database not in ("intake.sqlite3", "mobile.sqlite3"):
            raise ValueError("Unexpected database")
        by_database.setdefault(database, []).append((record["kind"], key, json.loads(record["content"])))
    if set(by_database) != {"intake.sqlite3", "mobile.sqlite3"}:
        raise ValueError("Both database archives are required")
    if any((destination / name).exists() for name in by_database):
        raise FileExistsError("Refusing to overwrite a restoration or live database")
    report = {}
    for name, items in by_database.items():
        schema = [value for kind, _, value in items if kind == "sqlite_schema"]
        tables = {}
        for kind, key, value in items:
            if kind == "sqlite_row":
                table = key.split("/", 1)[0]
                if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", table):
                    raise ValueError("Invalid table name")
                tables.setdefault(table, []).append(value)
        with sqlite3.connect(destination / name) as db:
            def authorize(action, first, second, database, origin):
                if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
                    return sqlite3.SQLITE_DENY
                if action == sqlite3.SQLITE_FUNCTION and second == "load_extension":
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK
            db.set_authorizer(authorize)
            pending = []
            for item in schema:
                statement = item["sql"]
                if item["name"] == "sqlite_sequence":
                    continue  # SQLite recreates this for AUTOINCREMENT tables.
                if re.match(r"CREATE\s+TABLE\b", statement, re.I):
                    db.execute(statement)
                    tables.setdefault(item["name"], [])
                elif re.match(r"CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER)\b", statement, re.I):
                    pending.append(statement)
                else:
                    raise ValueError("Unsupported archived schema statement")
            for table, rows in tables.items():
                for row in rows:
                    cols = list(row)
                    if not all(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", col) for col in cols):
                        raise ValueError("Invalid column name")
                    columns = ",".join('"' + col + '"' for col in cols)
                    db.execute('INSERT INTO "' + table + '" (' + columns + ') VALUES (' + ','.join('?' for _ in cols) + ')', [row[col] for col in cols])
            # Install audit triggers after replay so historical writes aren't duplicated.
            for statement in pending:
                db.execute(statement)
            db.commit()
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise ValueError("Restored database integrity failure")
            db.row_factory = sqlite3.Row
            counts = {}
            for table, rows in tables.items():
                restored = [dict(row) for row in db.execute('SELECT * FROM "' + table + '"')]
                if Counter(map(encoded, restored)) != Counter(map(encoded, rows)):
                    raise ValueError("Restored row content differs: " + table)
                counts[table] = len(restored)
            report[name] = {"integrity": integrity, "rows_verified": sum(counts.values()), "tables": counts}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("destination")
    args = parser.parse_args()
    result = restore(json.loads(Path(args.archive).read_text()), args.destination)
    print(json.dumps(result, indent=2))
