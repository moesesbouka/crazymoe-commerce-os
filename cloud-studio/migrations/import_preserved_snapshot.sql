-- Run inside a transaction after setting studio.migration_batch locally.
-- This loads the audited snapshot only. A fresh final delta is required at cutover.
CREATE TEMP TABLE studio_import_rendered ON COMMIT DROP AS
SELECT g FROM studio_migration.records r,
LATERAL jsonb_array_elements(r.content::jsonb) g
WHERE r.batch_id=current_setting('studio.migration_batch') AND r.kind='rendered_groups';
CREATE TEMP TABLE studio_import_saved ON COMMIT DROP AS
SELECT content::jsonb AS r FROM studio_migration.records
WHERE batch_id=current_setting('studio.migration_batch') AND kind='sqlite_row'
AND source_key LIKE 'intake.sqlite3/groups/%';

INSERT INTO studio_core.inventory(id,lifecycle,source_batch)
SELECT g->>'id','current',current_setting('studio.migration_batch') FROM studio_import_rendered;
INSERT INTO studio_core.inventory(id,lifecycle,source_batch)
SELECT r->>'id','legacy_only',current_setting('studio.migration_batch') FROM studio_import_saved
ON CONFLICT(id) DO NOTHING;
INSERT INTO studio_core.inventory(id,lifecycle,source_batch)
SELECT content::jsonb->>'group_id','legacy_only',current_setting('studio.migration_batch')
FROM studio_migration.records WHERE batch_id=current_setting('studio.migration_batch')
AND kind='sqlite_row' AND source_key LIKE 'mobile.sqlite3/approvals/%'
ON CONFLICT(id) DO NOTHING;

INSERT INTO studio_core.listing_authoring(inventory_id,fields)
SELECT id,'{}'::jsonb FROM studio_core.inventory;
UPDATE studio_core.listing_authoring a SET fields=(s.r->>'fields')::jsonb
FROM studio_import_saved s WHERE a.inventory_id=s.r->>'id';
INSERT INTO studio_core.field_provenance(inventory_id,field_name,source,actor,protected)
SELECT inventory_id,key,'legacy_preserved_unknown','migration',true
FROM studio_core.listing_authoring,LATERAL jsonb_each(fields);
UPDATE studio_core.field_provenance p SET
 source=r.content::jsonb->>'source',actor=r.content::jsonb->>'actor',
 historical_metadata=r.content::jsonb
FROM studio_migration.records r
WHERE r.batch_id=current_setting('studio.migration_batch') AND r.kind='sqlite_row'
AND r.source_key LIKE 'intake.sqlite3/listing_field_provenance/%'
AND p.inventory_id=r.content::jsonb->>'group_id' AND p.field_name=r.content::jsonb->>'field_name';

INSERT INTO studio_core.generated_copy(inventory_id,fields,source,based_on_revision)
SELECT g->>'id',g->'fields','legacy_rendered_candidate',1 FROM studio_import_rendered;
INSERT INTO studio_core.product_identity(inventory_id,identity,evidence,verification_status)
SELECT g->>'id',jsonb_build_object('model_number',g->'model_number','barcode',g->'barcode','identity_method',g->'identity_method'),
 coalesce(g->'visual_recognition','{}'::jsonb),coalesce(g->'visual_recognition'->>'status','unverified')
FROM studio_import_rendered;
INSERT INTO studio_core.research_evidence(inventory_id,research,source_batch)
SELECT g->>'id',jsonb_build_object('internal_research_notes',g->'internal_research_notes',
 'manufacturer_research',g->'manufacturer_research','model_search_candidates',g->'model_search_candidates',
 'retailer_search',g->'retailer_search','catalog_match',g->'catalog_match'),current_setting('studio.migration_batch')
FROM studio_import_rendered;
INSERT INTO studio_core.photo_selection(inventory_id,selection)
SELECT g->>'id',coalesce(g->'listing_photos','[]'::jsonb) FROM studio_import_rendered;

INSERT INTO studio_core.catalog_entries(source_key,facts,source_batch)
SELECT source_key,content::jsonb,batch_id FROM studio_migration.records
WHERE batch_id=current_setting('studio.migration_batch') AND kind='metadata' AND source_key='catalog.json';
INSERT INTO studio_core.manifest_evidence(source_key,evidence,source_batch)
SELECT source_key,content::jsonb,batch_id FROM studio_migration.records
WHERE batch_id=current_setting('studio.migration_batch') AND kind='metadata' AND source_key LIKE '%manifest%';
INSERT INTO studio_core.photo_assets(sha256,object_path,bytes,source_metadata)
SELECT p->>'sha','originals/'||(p->>'sha'),(p->>'bytes')::bigint,p
FROM studio_migration.records r,LATERAL jsonb_array_elements(r.content::jsonb) p
WHERE r.batch_id=current_setting('studio.migration_batch') AND r.kind='original_manifest';
INSERT INTO studio_core.approval_events(inventory_id,event,payload)
SELECT content::jsonb->>'group_id','legacy_preserved',content::jsonb
FROM studio_migration.records WHERE batch_id=current_setting('studio.migration_batch') AND kind='sqlite_row'
AND source_key LIKE 'mobile.sqlite3/approvals/%';
