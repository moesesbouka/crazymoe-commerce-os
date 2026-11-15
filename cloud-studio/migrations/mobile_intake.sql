create function studio_core.is_member() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from studio_core.members where user_id=auth.uid() and enabled)
$$;
revoke all on function studio_core.is_member() from public, anon, authenticated, service_role;
grant execute on function studio_core.is_member() to authenticated;

create policy studio_member_mobile_insert on storage.objects for insert to authenticated
with check (bucket_id='studio-originals' and studio_core.is_member()
 and name ~ ('^incoming/'||auth.uid()::text||'/[a-f0-9-]{36}/[a-f0-9]{64}$'));

create function public.studio_finish_intake(p_user uuid,p_batch uuid,p_files jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
 item_id text := 'cloud-' || p_batch::text;
 file jsonb;
 selected jsonb := '[]';
 previous jsonb;
begin
 if not exists(select 1 from studio_core.members where user_id=p_user and enabled) then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 12 then
  raise exception 'Invalid file count';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(item_id,0));
 select evidence into previous from studio_core.product_identity where inventory_id=item_id;
 if found then
  if previous=jsonb_build_object('uploaded_by',p_user,'files',p_files) then return item_id; end if;
  raise exception 'Upload batch conflict' using errcode='40001';
 end if;
 insert into studio_core.inventory(id) values(item_id);
 insert into studio_core.listing_authoring(inventory_id,fields) values(item_id,'{"condition":"New"}');
 insert into studio_core.field_provenance(inventory_id,field_name,source,actor)
 values(item_id,'condition','default','studio');
 insert into studio_core.product_identity(inventory_id,evidence)
 values(item_id,jsonb_build_object('uploaded_by',p_user,'files',p_files));
 for file in select * from jsonb_array_elements(p_files) loop
  if not exists(select 1 from storage.objects where bucket_id='studio-originals'
    and name='incoming/'||p_user::text||'/'||p_batch::text||'/'||(file->>'sha')
    and (metadata->>'size')::bigint=(file->>'bytes')::bigint) then raise exception 'Missing original'; end if;
  insert into studio_core.photo_assets(sha256,object_path,bytes,cloud_verified_at,source_metadata)
  values(file->>'sha','incoming/'||p_user::text||'/'||p_batch::text||'/'||(file->>'sha'),
    (file->>'bytes')::bigint,now(),file) on conflict(sha256) do nothing;
  selected := selected||jsonb_build_array(jsonb_build_object('kind','real','sha',file->>'sha','name',file->>'name'));
 end loop;
 insert into studio_core.photo_selection(inventory_id,selection) values(item_id,selected);
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload)
 values(item_id,'identify',item_id||':intake',jsonb_build_object('source','mobile'));
 return item_id;
end;
$$;
revoke all on function public.studio_finish_intake(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.studio_finish_intake(uuid,uuid,jsonb) to service_role;
