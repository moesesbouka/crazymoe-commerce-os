CREATE SCHEMA studio_migration;
REVOKE ALL ON SCHEMA studio_migration FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA studio_migration REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA studio_migration REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE studio_migration.batches (
 id text PRIMARY KEY,
 source_device text NOT NULL,
 source_path text NOT NULL,
 captured_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'staging' CHECK(status IN ('staging','verified_archive','rejected')),
 expected_records integer NOT NULL CHECK(expected_records>=0),
 original_count integer,
 original_bytes bigint,
 notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_migration.records (
 batch_id text NOT NULL REFERENCES studio_migration.batches(id),
 kind text NOT NULL,
 source_key text NOT NULL,
 content text NOT NULL CHECK(content::json IS NOT NULL),
 sha256 text NOT NULL CHECK(sha256=encode(pg_catalog.sha256(convert_to(content,'UTF8')),'hex')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(batch_id,kind,source_key)
);
ALTER TABLE studio_migration.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_migration.batches FORCE ROW LEVEL SECURITY;
ALTER TABLE studio_migration.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_migration.records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA studio_migration FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION studio_migration.reject_archive_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Migration evidence is append-only'; END; $$;
REVOKE ALL ON FUNCTION studio_migration.reject_archive_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_records BEFORE UPDATE OR DELETE OR TRUNCATE ON studio_migration.records
FOR EACH STATEMENT EXECUTE FUNCTION studio_migration.reject_archive_mutation();
COMMENT ON SCHEMA studio_migration IS 'Private migration evidence only. Not operational Studio; no cutover. Source remains office system until full acceptance.';
