-- Execute in a transaction after archiving the sender's independently downloaded
-- SHA-256 receipts. SET LOCAL studio.photo_evidence_batch to that evidence batch.
-- This is original-file verification only; it does not approve JPEG exports.
DO $$
DECLARE evidence_batch text := current_setting('studio.photo_evidence_batch');
 receipts jsonb; completion jsonb; expected_count integer; expected_bytes bigint;
BEGIN
 SELECT content::jsonb INTO STRICT receipts FROM studio_migration.records
 WHERE batch_id=evidence_batch AND kind='photo_receipts' AND source_key='originals';
 SELECT content::jsonb INTO STRICT completion FROM studio_migration.records
 WHERE batch_id=evidence_batch AND kind='photo_completion' AND source_key='originals';
 SELECT original_count,original_bytes INTO STRICT expected_count,expected_bytes
 FROM studio_migration.batches WHERE id=evidence_batch;
 IF expected_count IS NULL OR expected_count<=0 OR expected_bytes IS NULL
 OR jsonb_typeof(receipts)<>'array' OR jsonb_array_length(receipts)<>expected_count
 OR (completion->>'verified_count')::integer IS DISTINCT FROM expected_count
 OR (completion->>'bytes')::bigint IS DISTINCT FROM expected_bytes
 OR (completion->'closed'->>'closed')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Incomplete original-photo evidence';
 END IF;
 IF (SELECT count(DISTINCT x->>'sha256') FROM jsonb_array_elements(receipts) x)<>expected_count
 OR (SELECT sum((x->>'bytes')::bigint) FROM jsonb_array_elements(receipts) x)<>expected_bytes THEN
  RAISE EXCEPTION 'Duplicate receipts or byte total mismatch';
 END IF;
 IF EXISTS(
  SELECT 1 FROM jsonb_to_recordset(receipts) AS r(sha256 text,bytes bigint,bucket text,path text,verified boolean,verified_at timestamptz)
  FULL JOIN studio_core.photo_assets a ON a.sha256=r.sha256
  LEFT JOIN storage.objects o ON o.bucket_id=a.bucket AND o.name=a.object_path
  WHERE r.sha256 IS NULL OR a.sha256 IS NULL OR r.verified IS DISTINCT FROM true
   OR r.verified_at IS NULL OR r.bytes IS DISTINCT FROM a.bytes
   OR r.bucket IS DISTINCT FROM a.bucket OR r.path IS DISTINCT FROM a.object_path
   OR o.id IS NULL OR (o.metadata->>'size')::bigint IS DISTINCT FROM a.bytes
 ) THEN RAISE EXCEPTION 'Original photo receipt, inventory or storage mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='studio-originals' AND NOT public)
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='studio-originals' AND name='_migration/closed.json') THEN
  RAISE EXCEPTION 'Private photo migration is not closed';
 END IF;
 UPDATE studio_core.photo_assets a SET cloud_verified_at=r.verified_at
 FROM jsonb_to_recordset(receipts) AS r(sha256 text,verified_at timestamptz)
 WHERE a.sha256=r.sha256 AND a.cloud_verified_at IS NULL;
 UPDATE studio_migration.batches SET status='verified_archive'
 WHERE id=evidence_batch;
END; $$;
