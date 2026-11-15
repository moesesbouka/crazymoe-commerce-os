-- Additive private Studio model. Does not replace the public storefront tables.
CREATE SCHEMA studio_core;
REVOKE ALL ON SCHEMA studio_core FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA studio_core REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA studio_core REVOKE ALL ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE studio_core.members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('owner','editor')),
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE studio_core.inventory (
  id text PRIMARY KEY,
  lifecycle text NOT NULL DEFAULT 'current' CHECK (lifecycle IN ('current','legacy_only','archived')),
  source_batch text REFERENCES studio_migration.batches(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_core.product_identity (
  inventory_id text PRIMARY KEY REFERENCES studio_core.inventory(id),
  identity jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'unverified',
  revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE studio_core.catalog_entries (
  source_key text PRIMARY KEY,
  facts jsonb NOT NULL,
  source_batch text REFERENCES studio_migration.batches(id)
);
CREATE TABLE studio_core.manifest_evidence (
  source_key text PRIMARY KEY,
  evidence jsonb NOT NULL,
  source_batch text REFERENCES studio_migration.batches(id)
);
CREATE TABLE studio_core.research_evidence (
  inventory_id text PRIMARY KEY REFERENCES studio_core.inventory(id),
  research jsonb NOT NULL,
  source_batch text REFERENCES studio_migration.batches(id)
);
CREATE TABLE studio_core.listing_authoring (
  inventory_id text PRIMARY KEY REFERENCES studio_core.inventory(id),
  fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(fields)='object'),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','listed','archived')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_core.field_provenance (
  inventory_id text NOT NULL REFERENCES studio_core.inventory(id),
  field_name text NOT NULL,
  source text NOT NULL,
  actor text NOT NULL,
  protected boolean NOT NULL DEFAULT true,
  historical_metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(inventory_id,field_name)
);
CREATE TABLE studio_core.generated_copy (
  inventory_id text PRIMARY KEY REFERENCES studio_core.inventory(id),
  fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='object'),
  source text NOT NULL,
  based_on_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_core.photo_assets (
  sha256 text PRIMARY KEY CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  bucket text NOT NULL DEFAULT 'studio-originals',
  object_path text NOT NULL UNIQUE,
  bytes bigint NOT NULL CHECK(bytes>0),
  cloud_verified_at timestamptz,
  source_metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE studio_core.photo_selection (
  inventory_id text PRIMARY KEY REFERENCES studio_core.inventory(id),
  selection jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(selection)='array'),
  revision bigint NOT NULL DEFAULT 1,
  exports_verified boolean NOT NULL DEFAULT false
);
CREATE TABLE studio_core.approval_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id text NOT NULL REFERENCES studio_core.inventory(id),
  event text NOT NULL CHECK(event IN ('legacy_preserved','approved','invalidated','published')),
  listing_revision bigint,
  payload jsonb NOT NULL,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_core.listing_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id text NOT NULL REFERENCES studio_core.inventory(id),
  before_revision bigint NOT NULL,
  after_revision bigint NOT NULL,
  old_fields jsonb NOT NULL,
  new_fields jsonb NOT NULL,
  actor uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(inventory_id,after_revision)
);
CREATE TABLE studio_core.field_proposals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inventory_id text NOT NULL REFERENCES studio_core.inventory(id),
  fields jsonb NOT NULL,
  based_on_revision bigint NOT NULL,
  source text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE studio_core.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id text REFERENCES studio_core.inventory(id),
  kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_jobs_available ON studio_core.jobs(state,available_at);

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='studio_core' LOOP
    EXECUTE format('ALTER TABLE studio_core.%I ENABLE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('ALTER TABLE studio_core.%I FORCE ROW LEVEL SECURITY',t.tablename);
  END LOOP;
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA studio_core FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA studio_core FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION studio_core.append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Studio history is append-only'; END; $$;
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON studio_core.listing_revisions
FOR EACH STATEMENT EXECUTE FUNCTION studio_core.append_only();
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON studio_core.approval_events
FOR EACH STATEMENT EXECUTE FUNCTION studio_core.append_only();

-- Only this explicit seller command may change authoring fields. It is not an
-- exposed API yet: the application wrapper and login must be tested separately.
CREATE FUNCTION studio_core.seller_patch(p_id text,p_expected_revision bigint,p_patch jsonb,p_reason text DEFAULT 'seller edit')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row studio_core.listing_authoring%ROWTYPE; merged jsonb; actor_id uuid := auth.uid(); k text;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=actor_id AND enabled) THEN
    RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'Patch must be a nonempty object';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('title','description','price','condition','notes','model','category','source_url') OR jsonb_typeof(p_patch->k)<>'string' THEN
      RAISE EXCEPTION 'Unsupported field or non-string value: %',k;
    END IF;
  END LOOP;
  SELECT * INTO old_row FROM studio_core.listing_authoring WHERE inventory_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory not found'; END IF;
  IF p_expected_revision IS NULL OR old_row.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Listing changed; refresh before saving' USING ERRCODE='40001';
  END IF;
  merged := old_row.fields || p_patch;
  INSERT INTO studio_core.listing_revisions(inventory_id,before_revision,after_revision,old_fields,new_fields,actor,reason)
  VALUES(p_id,old_row.revision,old_row.revision+1,old_row.fields,merged,actor_id,coalesce(p_reason,'seller edit'));
  INSERT INTO studio_core.field_provenance(inventory_id,field_name,source,actor,protected)
  SELECT p_id,key,'seller',actor_id::text,true FROM jsonb_each(p_patch)
  ON CONFLICT(inventory_id,field_name) DO UPDATE SET source='seller',actor=excluded.actor,protected=true,updated_at=now();
  IF old_row.status='approved' THEN
    INSERT INTO studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
    VALUES(p_id,'invalidated',old_row.revision,jsonb_build_object('reason','seller content changed'),actor_id);
  END IF;
  UPDATE studio_core.listing_authoring SET fields=merged,revision=revision+1,
    status=CASE WHEN status='listed' THEN 'listed' ELSE 'review' END,updated_at=now() WHERE inventory_id=p_id;
  RETURN jsonb_build_object('id',p_id,'revision',old_row.revision+1,'fields',merged);
END; $$;

CREATE FUNCTION studio_core.rollback_fields(p_id text,p_expected_revision bigint,p_event bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; current_fields jsonb; patch jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=auth.uid() AND enabled) THEN
    RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
  END IF;
  SELECT old_fields INTO prior FROM studio_core.listing_revisions WHERE id=p_event AND inventory_id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision not found'; END IF;
  SELECT fields INTO current_fields FROM studio_core.listing_authoring WHERE inventory_id=p_id;
  -- Missing historic text values become explicit clears, preserving seller intent.
  SELECT jsonb_object_agg(k,coalesce(prior->k,'""'::jsonb)) INTO patch
  FROM (SELECT jsonb_object_keys(prior||current_fields) k) keys
  WHERE k IN ('title','description','price','condition','notes','model','category','source_url');
  RETURN studio_core.seller_patch(p_id,p_expected_revision,patch,'rollback before revision event '||p_event);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA studio_core FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON SCHEMA studio_core IS 'Private normalized Studio foundation. No application cutover or public RPC exposure yet.';
