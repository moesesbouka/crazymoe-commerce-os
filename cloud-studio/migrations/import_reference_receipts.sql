-- Execute inside a transaction after archiving all reference-file evidence.
-- SET LOCAL studio.reference_evidence_batch to the evidence batch ID.
DO $$
DECLARE batch text:=current_setting('studio.reference_evidence_batch');
 manifest jsonb; receipts jsonb; completion jsonb; expected_count integer; expected_bytes bigint;
BEGIN
 SELECT content::jsonb INTO STRICT manifest FROM studio_migration.records
 WHERE batch_id=batch AND kind='manufacturer_manifest' AND source_key='references';
 SELECT content::jsonb INTO STRICT receipts FROM studio_migration.records
 WHERE batch_id=batch AND kind='photo_receipts' AND source_key='references';
 SELECT content::jsonb INTO STRICT completion FROM studio_migration.records
 WHERE batch_id=batch AND kind='photo_completion' AND source_key='references';
 SELECT original_count,original_bytes INTO STRICT expected_count,expected_bytes FROM studio_migration.batches WHERE id=batch;
 IF expected_count IS NULL OR expected_count<=0 OR expected_bytes IS NULL
 OR jsonb_array_length(receipts)<>expected_count
 OR (SELECT count(DISTINCT x->>'sha256') FROM jsonb_array_elements(receipts) x)<>expected_count
 OR (SELECT sum((x->>'bytes')::bigint) FROM jsonb_array_elements(receipts) x)<>expected_bytes
 OR (completion->>'verified_count')::integer IS DISTINCT FROM expected_count
 OR (completion->>'bytes')::bigint IS DISTINCT FROM expected_bytes
 OR (completion->'closed'->>'closed')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Incomplete manufacturer photo evidence';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(receipts) r(sha256 text,bytes bigint,bucket text,path text,verified boolean,verified_at timestamptz)
 LEFT JOIN storage.objects o ON o.bucket_id=r.bucket AND o.name=r.path
 WHERE r.verified IS DISTINCT FROM true OR r.verified_at IS NULL
 OR r.bucket IS DISTINCT FROM 'studio-originals' OR r.path IS DISTINCT FROM 'references/'||r.sha256
 OR o.id IS NULL OR (o.metadata->>'size')::bigint IS DISTINCT FROM r.bytes) THEN
  RAISE EXCEPTION 'Reference storage receipt mismatch';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(manifest) m
 JOIN jsonb_to_recordset(receipts) r(sha256 text,bytes bigint) ON r.sha256=m->>'sha256' AND r.bytes=(m->>'bytes')::bigint)<>jsonb_array_length(manifest)
 OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='studio-originals' AND NOT public)
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='studio-originals' AND name='_migration/references-closed.json') THEN
  RAISE EXCEPTION 'Reference manifest incomplete or import not closed';
 END IF;
 INSERT INTO studio_core.reference_assets(inventory_id,reference_id,sha256,bucket,object_path,bytes,cloud_verified_at,source_metadata)
 SELECT m->>'inventory_id',m->>'id',r.sha256,r.bucket,r.path,r.bytes,r.verified_at,m
 FROM jsonb_array_elements(manifest) m JOIN jsonb_to_recordset(receipts) r(sha256 text,bytes bigint,bucket text,path text,verified_at timestamptz)
 ON r.sha256=m->>'sha256';
 UPDATE studio_migration.batches SET status='verified_archive' WHERE id=batch;
END; $$;
