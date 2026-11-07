-- Rehydrate only session-local tables. Source tables and running workers are never changed.
create function public.studio_rehearse_backup(p_token text,p_document jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tbl record; fk record; snapshot jsonb; actual jsonb; layout jsonb; counts jsonb:='{}'; predicate text; invalid boolean;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Backup credential rejected' using errcode='42501'; end if;
 if (p_document->>'format') is distinct from '1' then raise exception 'Unsupported recovery document'; end if;
 for tbl in select c.relname,c.oid from pg_class c join pg_namespace n on c.relnamespace=n.oid
  where n.nspname='studio_core' and c.relkind='r' order by c.relname loop
  snapshot:=p_document->'tables'->tbl.relname;
  select jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull,attidentity) order by attnum) into layout
   from pg_attribute where attrelid=tbl.oid and attnum>0 and not attisdropped;
  if snapshot->'layout' is distinct from layout or jsonb_typeof(snapshot->'rows') is distinct from 'array'
   then raise exception 'Missing or incompatible table %',tbl.relname; end if;
  execute format('create temporary table %I (like studio_core.%I including all) on commit drop',tbl.relname,tbl.relname);
  execute format('insert into pg_temp.%I overriding system value select * from jsonb_populate_recordset(null::studio_core.%I,$1)',tbl.relname,tbl.relname)
   using snapshot->'rows';
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from pg_temp.%I t',tbl.relname) into actual;
  if actual is distinct from snapshot->'rows' or jsonb_array_length(actual) is distinct from (snapshot->>'count')::int then
   raise exception 'Restored contents differ for %',tbl.relname; end if;
  counts:=counts||jsonb_build_object(tbl.relname,jsonb_array_length(actual));
 end loop;
 if (select count(*) from jsonb_object_keys(counts))<>(select count(*) from jsonb_object_keys(p_document->'tables')) then raise exception 'Unexpected backup tables'; end if;
 for fk in select c.*,child.relname as child_name,parent.relname as parent_name,ns.nspname as parent_schema
  from pg_constraint c join pg_class child on child.oid=c.conrelid join pg_namespace sc on sc.oid=child.relnamespace
  join pg_class parent on parent.oid=c.confrelid join pg_namespace ns on ns.oid=parent.relnamespace
  where c.contype='f' and sc.nspname='studio_core' loop
  select string_agg(format('a.%I=b.%I',src.attname,dst.attname),' and ' order by k.i) into predicate
  from generate_subscripts(fk.conkey,1) k(i) join pg_attribute src on src.attrelid=fk.conrelid and src.attnum=fk.conkey[k.i]
   join pg_attribute dst on dst.attrelid=fk.confrelid and dst.attnum=fk.confkey[k.i];
  execute format('select exists(select 1 from pg_temp.%I a where %s and not exists(select 1 from %I.%I b where %s))',
   fk.child_name,(select string_agg(format('a.%I is not null',attname),' and ') from pg_attribute where attrelid=fk.conrelid and attnum=any(fk.conkey)),
   case when fk.parent_schema='studio_core' then 'pg_temp' else fk.parent_schema end,fk.parent_name,predicate) into invalid;
  if invalid then raise exception 'Broken restored relationship %',fk.conname; end if;
 end loop;
 return counts;
end $$;
revoke all on function public.studio_rehearse_backup(text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_rehearse_backup(text,jsonb) to service_role;
