CREATE TABLE studio_core.reference_assets (
 inventory_id text NOT NULL REFERENCES studio_core.inventory(id),
 reference_id text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 bucket text NOT NULL,
 object_path text NOT NULL,
 bytes bigint NOT NULL CHECK(bytes>0),
 cloud_verified_at timestamptz NOT NULL,
 source_metadata jsonb NOT NULL,
 PRIMARY KEY(inventory_id,reference_id)
);
ALTER TABLE studio_core.reference_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_core.reference_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON studio_core.reference_assets FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE studio_core.reference_assets IS 'Preserved manufacturer-reference files. Presence does not verify product identity, usage rights or approval.';
