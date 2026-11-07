-- Run in a transaction with the immutable evidence batch already inserted.
do $$
declare batch text := current_setting('studio.export_evidence_batch');
 sets jsonb; receipts jsonb; expected int; expected_bytes bigint;
begin
 select original_count,original_bytes into strict expected,expected_bytes from studio_migration.batches where id=batch;
 select content::jsonb into strict sets from studio_migration.records where batch_id=batch and kind='export_sets';
 select content::jsonb into strict receipts from studio_migration.records where batch_id=batch and kind='download_receipts';
 if (select count(distinct r->>'sha') from jsonb_array_elements(receipts) r)<>expected
 or jsonb_array_length(receipts)<>expected or (select sum((r->>'bytes')::bigint) from jsonb_array_elements(receipts) r)<>expected_bytes
 or not exists(select 1 from storage.objects where bucket_id='studio-originals' and name='_migration/jpeg-20261105-closed.json')
 then raise exception 'Incomplete receipt evidence'; end if;
 if exists(select 1 from jsonb_to_recordset(sets) x(id text,selection jsonb,images jsonb)
 left join studio_core.photo_selection s on s.inventory_id=x.id
 where s.selection is distinct from x.selection or jsonb_array_length(x.images)<>jsonb_array_length(x.selection))
 then raise exception 'Selection changed'; end if;
 if exists(select 1 from jsonb_array_elements(sets) x cross join lateral jsonb_array_elements(x->'images') i
 left join jsonb_to_recordset(receipts) r(sha text,bytes bigint,verified_at timestamptz) on r.sha=i->>'sha'
 left join storage.objects o on o.bucket_id='studio-originals' and o.name='exports/'||(i->>'sha')
 where r.verified_at is null or r.bytes is distinct from (i->>'bytes')::bigint or (o.metadata->>'size')::bigint is distinct from r.bytes)
 then raise exception 'JPEG proof mismatch'; end if;
 insert into studio_core.export_sets(inventory_id,selection,images)
 select id,selection,images from jsonb_to_recordset(sets) x(id text,selection jsonb,images jsonb);
 update studio_core.photo_selection s set exports_verified=true from studio_core.export_sets e
 where e.inventory_id=s.inventory_id and e.selection=s.selection;
 update studio_migration.batches set status='verified_archive' where id=batch;
end $$;
