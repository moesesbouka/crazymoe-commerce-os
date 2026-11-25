-- Operator-only report. The row set is independent of the storage listing.
-- Compare each table-backed photo with storage, including unused verified choices.
with expected as (
 select object_path path,sha256,bytes from studio_core.photo_assets where cloud_verified_at is not null
 union
 select object_path,sha256,bytes from studio_core.reference_assets where cloud_verified_at is not null
 union
 select 'exports/'||choice,choice,(image->>'bytes')::bigint from studio_core.photo_choices
 union
 select 'exports/'||(img->>'sha'),img->>'sha',(img->>'bytes')::bigint
 from studio_core.export_sets cross join lateral jsonb_array_elements(images) img
), stored as (
 select name as path,(metadata->>'size')::bigint as bytes from storage.objects
 where bucket_id='studio-originals' and split_part(name,'/',1) in ('originals','references','exports','incoming')
), discrepancies as (
 select coalesce(e.path,s.path) path from expected e full join stored s using(path)
 where e.path is null or s.path is null or e.bytes is distinct from s.bytes
 or e.sha256 is distinct from regexp_replace(e.path,'^.*/','')
)
select count(*) as objects, sum(bytes) as bytes,
 encode(sha256(convert_to(string_agg(path||chr(9)||bytes::text||chr(10),'' order by path collate "C"),'UTF8')),'hex') as manifest_sha256,
 (select count(*) from discrepancies) as discrepancies
from stored;
