create function public.studio_backup_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tbl record; rows jsonb; tables jsonb := '{}'; layout jsonb;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Backup credential rejected' using errcode='42501'; end if;
 for tbl in select c.relname,c.oid from pg_class c join pg_namespace n on c.relnamespace=n.oid
  where n.nspname='studio_core' and c.relkind='r' order by c.relname loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from studio_core.%I t',tbl.relname) into rows;
  select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,attidentity) order by attnum) into layout
   from pg_attribute where attrelid=tbl.oid and attnum>0 and not attisdropped;
  tables:=tables||jsonb_build_object(tbl.relname,jsonb_build_object('layout',layout,'rows',rows,'count',jsonb_array_length(rows)));
 end loop;
 return jsonb_build_object('format',1,'taken_at',statement_timestamp(),'tables',tables);
end $$;
revoke all on function public.studio_backup_document(text) from public,anon,authenticated;
grant execute on function public.studio_backup_document(text) to service_role;

create table studio_migration.recovery_receipts (
 object_name text primary key,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 compressed_bytes integer not null check(compressed_bytes>0),table_counts jsonb not null,verified_at timestamptz not null default now()
);
alter table studio_migration.recovery_receipts enable row level security;
alter table studio_migration.recovery_receipts force row level security;
revoke all on studio_migration.recovery_receipts from public,anon,authenticated,service_role;
create function public.studio_record_backup(p_path text,p_sha text,p_bytes int,p_counts jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_path !~ '^recovery/[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-f0-9-]{36}.json.gz$' or
 not exists(select 1 from storage.objects where bucket_id='studio-originals' and name=p_path and (metadata->>'size')::int=p_bytes)
 then raise exception 'Backup object missing'; end if;
 insert into studio_migration.recovery_receipts(object_name,sha256,compressed_bytes,table_counts) values(p_path,p_sha,p_bytes,p_counts);
end $$;
revoke all on function public.studio_record_backup(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.studio_record_backup(text,text,integer,jsonb) to service_role;
