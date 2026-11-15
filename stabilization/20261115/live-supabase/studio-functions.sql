-- public.studio_add_catalog_evidence(p_item text, p_listing_revision bigint, p_identity_revision bigint, p_source_kind text, p_url text, p_product_name text, p_brand text, p_model text, p_evidence jsonb)
CREATE OR REPLACE FUNCTION public.studio_add_catalog_evidence(p_item text, p_listing_revision bigint, p_identity_revision bigint, p_source_kind text, p_url text, p_product_name text, p_brand text, p_model text, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select studio_core.add_catalog_evidence(p_item,p_listing_revision,p_identity_revision,p_source_kind,
  p_url,p_product_name,p_brand,p_model,p_evidence);
$function$

-- public.studio_append_manual_photo(p_user uuid, p_item text, p_expected_photo_revision bigint, p_file jsonb, p_kind text)
CREATE OR REPLACE FUNCTION public.studio_append_manual_photo(p_user uuid, p_item text, p_expected_photo_revision bigint, p_file jsonb, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 a studio_core.listing_authoring%rowtype;
 s studio_core.photo_selection%rowtype;
 e studio_core.export_sets%rowtype;
 sha text:=p_file->>'sha';
 bytes_count bigint;
 ref text;
 item_source jsonb;
 jpeg jsonb;
 next_position integer;
 previous_count integer;
begin
 if session_user <> 'postgres' and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' and coalesce(auth.jwt()->>'role','') <> 'service_role' then
  raise exception 'Privileged verification required' using errcode='42501';
 end if;
 if not exists(select 1 from studio_core.members where user_id=p_user and enabled) then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 if p_kind not in ('real','manufacturer') or sha !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid photo type or digest';
 end if;
 if (p_file->>'bytes') !~ '^[0-9]+$' or (p_file->>'width') !~ '^[0-9]+$' or (p_file->>'height') !~ '^[0-9]+$' then
  raise exception 'Invalid photo metadata';
 end if;
 bytes_count := (p_file->>'bytes')::bigint;
 if bytes_count not between 500 and 16000000 or (p_file->>'width')::integer not between 100 and 4096 or (p_file->>'height')::integer not between 100 and 4096 then
  raise exception 'Invalid image size';
 end if;
 if not exists(select 1 from storage.objects where bucket_id='studio-originals' and name='exports/'||sha
    and (metadata->>'size')::bigint=bytes_count) then
  raise exception 'Uploaded JPEG not verified';
 end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 if s.revision<>p_expected_photo_revision then raise exception 'Photos changed; refresh and retry' using errcode='40001';end if;
 if a.status not in ('review','approved') then raise exception 'Product not editable';end if;
 select * into e from studio_core.export_sets where inventory_id=p_item for update;
 if e.inventory_id is not null and (not s.exports_verified or e.selection is distinct from s.selection or jsonb_array_length(e.images)<>jsonb_array_length(s.selection)) then
   raise exception 'Prepare the existing photo set before adding photos' using errcode='23514';
 end if;
 if e.inventory_id is null and jsonb_array_length(s.selection)>0 then
   raise exception 'Prepare the existing photo set before adding photos' using errcode='23514';
 end if;
 previous_count:=jsonb_array_length(s.selection);
 if previous_count>=10 then raise exception 'Ten-photo limit reached; remove a selected image first';end if;
 if exists(select 1 from studio_core.photo_choices where inventory_id=p_item and choice=sha) then
   raise exception 'This image is already in the listing';
 end if;
 jpeg:=jsonb_build_object('sha',sha,'bytes',bytes_count,'width',(p_file->>'width')::integer,'height',(p_file->>'height')::integer);
 if p_kind='real' then
  insert into studio_core.photo_assets(sha256,bucket,object_path,bytes,cloud_verified_at,source_metadata)
   values(sha,'studio-originals','exports/'||sha,bytes_count,now(),p_file||jsonb_build_object('manual_upload',true))
   on conflict(sha256) do nothing;
  item_source:=jsonb_build_object('kind','real','sha',sha,'name',left(coalesce(p_file->>'name','Added photo'),200),'style_mode','natural','facebook_ready',true,'manual_upload',true);
 else
  ref:=coalesce(nullif(p_file->>'reference_id',''),'manual-'||left(sha,32));
  if p_file->>'reference_id' is not null and not exists(select 1 from studio_core.reference_assets where inventory_id=p_item and reference_id=ref and cloud_verified_at is not null) then
   raise exception 'Reference does not belong to this product' using errcode='42501';end if;
  insert into studio_core.reference_assets(inventory_id,reference_id,sha256,bucket,object_path,bytes,cloud_verified_at,source_metadata)
   values(p_item,ref,sha,'studio-originals','exports/'||sha,bytes_count,now(),
    jsonb_build_object('label','Seller-added product photo','manual_upload',true,'source_url',coalesce(p_file->>'source_url','')))
   on conflict(inventory_id,reference_id) do nothing;
  item_source:=jsonb_build_object('kind','manufacturer','id',ref,'name',left(coalesce(p_file->>'name','Added photo'),200),'style_mode','natural','facebook_ready',true,'manual_upload',true);
 end if;
 select coalesce(max(position),0)+1 into next_position from studio_core.photo_choices where inventory_id=p_item;
 if p_file->'original' is not null and jsonb_typeof(p_file->'original')='object' then
  if not exists(select 1 from storage.objects where bucket_id='studio-originals' and name=p_file->'original'->>'path' and (metadata->>'size')::bigint=(p_file->'original'->>'bytes')::bigint) then raise exception 'Original file missing';end if;
  insert into studio_core.photo_assets(sha256,bucket,object_path,bytes,cloud_verified_at,source_metadata)
  values(p_file->'original'->>'sha','studio-originals',p_file->'original'->>'path',(p_file->'original'->>'bytes')::bigint,now(),jsonb_build_object('inventory_id',p_item,'private_original',true,'name',p_file->>'name')) on conflict(sha256) do nothing;
 end if;
 insert into studio_core.photo_choices(inventory_id,position,choice,source,image)
 values(p_item,next_position,sha,item_source,jpeg);
 update studio_core.photo_selection set selection=s.selection||jsonb_build_array(item_source),
   revision=revision+1,exports_verified=true where inventory_id=p_item;
 if e.inventory_id is null then
  insert into studio_core.export_sets(inventory_id,selection,images,verified_at)
  values(p_item,s.selection||jsonb_build_array(item_source),jsonb_build_array(jpeg),now());
 else
  update studio_core.export_sets
  set selection=s.selection||jsonb_build_array(item_source),
      images=e.images||jsonb_build_array(jpeg),verified_at=now() where inventory_id=p_item;
 end if;
 if a.status='approved' then
  insert into studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
   values(p_item,'invalidated',a.revision,jsonb_build_object('reason','manual_photo_added'),p_user);
  update studio_core.listing_authoring set status='review',updated_at=now() where inventory_id=p_item;
 end if;
 return jsonb_build_object('ok',true,'id',p_item,'photo_revision',s.revision+1,'count',previous_count+1,'sha',sha);
end $function$

-- public.studio_approve_export(p_item text, p_revision bigint, p_snapshot jsonb)
CREATE OR REPLACE FUNCTION public.studio_approve_export(p_item text, p_revision bigint, p_snapshot jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 perform studio_core.assert_releasable_photo_identity(p_item);
 return studio_core.approve_export(p_item,p_revision,p_snapshot);
end $function$

-- public.studio_asset_access(p_sha text)
CREATE OR REPLACE FUNCTION public.studio_asset_access(p_sha text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT studio_core.asset_access(p_sha); $function$

-- public.studio_backup_document(p_token text)
CREATE OR REPLACE FUNCTION public.studio_backup_document(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$

-- public.studio_claim_handoff(p_secret text)
CREATE OR REPLACE FUNCTION public.studio_claim_handoff(p_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h studio_core.handoffs; snapshot jsonb;
begin
 if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into h from studio_core.handoffs where token_hash=sha256(convert_to(p_secret,'UTF8'))
 and claimed_at is null and expires_at>now() for update;
 if not found then return null; end if;
 select e.payload into snapshot from studio_core.approval_events e join studio_core.listing_authoring a using(inventory_id)
 join studio_core.photo_selection s using(inventory_id) join studio_core.export_sets x using(inventory_id)
 where e.id=h.approval_id and e.event='approved' and a.status='approved' and a.revision=e.listing_revision
 and s.exports_verified and s.selection=x.selection and s.revision=(e.payload->>'photo_revision')::bigint
 and x.images=e.payload->'images' and exists(select 1 from studio_core.members where user_id=h.issued_by and enabled)
 for share of a,s,x;
 update studio_core.handoffs set claimed_at=now() where token_hash=h.token_hash;
 return snapshot;
end $function$

-- public.studio_confirm_published(p_item text, p_revision bigint, p_confirmed boolean)
CREATE OR REPLACE FUNCTION public.studio_confirm_published(p_item text, p_revision bigint, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.confirm_published(p_item,p_revision,p_confirmed)$function$

-- public.studio_export_preview(p_item text, p_revision bigint)
CREATE OR REPLACE FUNCTION public.studio_export_preview(p_item text, p_revision bigint)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.export_preview(p_item,p_revision); $function$

-- public.studio_finish_intake(p_user uuid, p_batch uuid, p_files jsonb)
CREATE OR REPLACE FUNCTION public.studio_finish_intake(p_user uuid, p_batch uuid, p_files jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 item_id text := 'cloud-' || p_batch::text;
 file jsonb;
 selected jsonb := '[]';
 previous jsonb;
begin
 if not exists(select 1 from studio_core.members where user_id=p_user and enabled) then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 10 then
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
$function$

-- public.studio_issue_handoff(p_item text, p_revision bigint)
CREATE OR REPLACE FUNCTION public.studio_issue_handoff(p_item text, p_revision bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 perform studio_core.assert_releasable_photo_identity(p_item);
 return studio_core.issue_handoff(p_item,p_revision);
end $function$

-- public.studio_media_audit()
CREATE OR REPLACE FUNCTION public.studio_media_audit()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select studio_core.media_audit() $function$

-- public.studio_mercari_catalog(p_action text, p_items jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_catalog(p_action text DEFAULT 'state'::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_catalog(p_action,p_items)$function$

-- public.studio_mercari_categories(p_paths jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_categories(p_paths jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_categories(p_paths)$function$

-- public.studio_mercari_finish_recovery(p_user uuid, p_id uuid, p_revision integer, p_batch uuid, p_files jsonb, p_description text, p_condition text)
CREATE OR REPLACE FUNCTION public.studio_mercari_finish_recovery(p_user uuid, p_id uuid, p_revision integer, p_batch uuid, p_files jsonb, p_description text, p_condition text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_finish_recovery(p_user,p_id,p_revision,p_batch,p_files,p_description,p_condition)$function$

-- public.studio_mercari_handoff(p_id uuid, p_revision integer, p_event text, p_details jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_handoff(p_id uuid, p_revision integer, p_event text, p_details jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_handoff(p_id,p_revision,p_event,p_details)$function$

-- public.studio_mercari_inventory(p_kind text, p_query text, p_offset integer, p_limit integer)
CREATE OR REPLACE FUNCTION public.studio_mercari_inventory(p_kind text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_inventory(p_kind,p_query,p_offset,p_limit)$function$

-- public.studio_mercari_prepare(p_rows jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_prepare(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_prepare(p_rows)$function$

-- public.studio_mercari_preset(p_name text, p_shipping jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_preset(p_name text, p_shipping jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_preset(p_name,p_shipping)$function$

-- public.studio_mercari_research_work(p_token text, p_action text, p_id uuid, p_lease uuid, p_result jsonb)
CREATE OR REPLACE FUNCTION public.studio_mercari_research_work(p_token text, p_action text, p_id uuid DEFAULT NULL::uuid, p_lease uuid DEFAULT NULL::uuid, p_result jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$select studio_core.mercari_research_work(p_token,p_action,p_id,p_lease,p_result)$function$

-- public.studio_mercari_state()
CREATE OR REPLACE FUNCTION public.studio_mercari_state()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_state()$function$

-- public.studio_mercari_update(p_id uuid, p_revision integer, p_action text, p_draft jsonb, p_url text)
CREATE OR REPLACE FUNCTION public.studio_mercari_update(p_id uuid, p_revision integer, p_action text, p_draft jsonb DEFAULT NULL::jsonb, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select studio_core.mercari_update(p_id,p_revision,p_action,p_draft,p_url)$function$

-- public.studio_photo_choices(p_item text)
CREATE OR REPLACE FUNCTION public.studio_photo_choices(p_item text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select jsonb_build_object('revision',s.revision,'listing_revision',a.revision,
 'choices',(select coalesce(jsonb_agg(jsonb_build_object('id',c.choice,'source',c.source,'position',c.position) order by c.position),'[]') from studio_core.photo_choices c where c.inventory_id=p_item),
 'selected',(select coalesce(jsonb_agg(i.image->>'sha' order by pos),'[]') from jsonb_array_elements(e.images) with ordinality i(image,pos)),
 'previous',(select before_order from studio_core.photo_changes where inventory_id=p_item and revision=s.revision))
 into strict result from studio_core.photo_selection s join studio_core.listing_authoring a using(inventory_id)
 left join studio_core.export_sets e using(inventory_id) where s.inventory_id=p_item;
 return result;
end $function$

-- public.studio_posting_accounts(p_label text, p_profile text, p_tag text)
CREATE OR REPLACE FUNCTION public.studio_posting_accounts(p_label text DEFAULT NULL::text, p_profile text DEFAULT NULL::text, p_tag text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_accounts(p_label,p_profile,p_tag) $function$

-- public.studio_posting_claim(p_id uuid, p_revision integer)
CREATE OR REPLACE FUNCTION public.studio_posting_claim(p_id uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_claim(p_id,p_revision) $function$

-- public.studio_posting_inventory(p_query text, p_offset integer, p_limit integer)
CREATE OR REPLACE FUNCTION public.studio_posting_inventory(p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_inventory(p_query,p_offset,p_limit) $function$

-- public.studio_posting_prepare(p_account uuid, p_rows jsonb)
CREATE OR REPLACE FUNCTION public.studio_posting_prepare(p_account uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_prepare(p_account,p_rows) $function$

-- public.studio_posting_queue()
CREATE OR REPLACE FUNCTION public.studio_posting_queue()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_queue() $function$

-- public.studio_posting_result(p_id uuid, p_revision integer, p_action text, p_url text)
CREATE OR REPLACE FUNCTION public.studio_posting_result(p_id uuid, p_revision integer, p_action text, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_result(p_id,p_revision,p_action,p_url) $function$

-- public.studio_posting_transfer(p_token text, p_action text, p_evidence jsonb)
CREATE OR REPLACE FUNCTION public.studio_posting_transfer(p_token text, p_action text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select studio_core.studio_posting_transfer(p_token,p_action,p_evidence) $function$

-- public.studio_record_backup(p_path text, p_sha text, p_bytes integer, p_counts jsonb)
CREATE OR REPLACE FUNCTION public.studio_record_backup(p_path text, p_sha text, p_bytes integer, p_counts jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_path !~ '^recovery/[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-f0-9-]{36}.json.gz$' or
 not exists(select 1 from storage.objects where bucket_id='studio-originals' and name=p_path and (metadata->>'size')::int=p_bytes)
 then raise exception 'Backup object missing'; end if;
 insert into studio_migration.recovery_receipts(object_name,sha256,compressed_bytes,table_counts) values(p_path,p_sha,p_bytes,p_counts);
end $function$

-- public.studio_reference_access(p_item text, p_reference text)
CREATE OR REPLACE FUNCTION public.studio_reference_access(p_item text, p_reference text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT studio_core.reference_access(p_item,p_reference); $function$

-- public.studio_reference_choices(p_item text)
CREATE OR REPLACE FUNCTION public.studio_reference_choices(p_item text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not studio_core.is_member() then
  raise exception 'Studio access denied' using errcode = '42501';
 end if;
 return (
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', r.reference_id,
   'label', left(coalesce(r.source_metadata->>'label','Manufacturer/retailer reference'),160),
   'source_url', r.source_metadata->>'source_url',
   'prepared', exists (
     select 1 from studio_core.photo_choices c
     where c.inventory_id=r.inventory_id and c.source->>'kind'='manufacturer'
       and c.source->>'id'=r.reference_id)
 ) order by r.reference_id), '[]'::jsonb)
 from studio_core.reference_assets r
 where r.inventory_id=p_item and r.cloud_verified_at is not null
 );
end $function$

-- public.studio_refresh_copy_suggestion(p_item text, p_revision bigint)
CREATE OR REPLACE FUNCTION public.studio_refresh_copy_suggestion(p_item text, p_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare listing studio_core.listing_authoring; candidate studio_core.generated_copy; result jsonb; original text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict listing from studio_core.listing_authoring where inventory_id=p_item for update;
 if listing.revision<>p_revision then raise exception 'Listing changed; refresh before generating a suggestion' using errcode='40001';end if;
 select * into candidate from studio_core.generated_copy where inventory_id=p_item;
 original:=coalesce(nullif(listing.fields->>'description',''),candidate.fields->>'description','');
 if length(trim(original))=0 then raise exception 'No supported description exists yet. Add product facts first.';end if;
 result:=studio_core.clean_copy(original);
 if length(trim(result->>'description'))=0 then raise exception 'Only internal notes are available. Add product facts first.';end if;
 insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence)
 values(p_item,jsonb_build_object('description',result->>'description'),p_revision,'owner_requested_copy_cleanup',jsonb_build_object('method','product-facts-only-v2'));
 insert into studio_core.generated_copy(inventory_id,fields,source,based_on_revision)
 values(p_item,coalesce(candidate.fields,'{}'::jsonb)||jsonb_build_object('description',result->>'description'),'owner_requested_copy_cleanup',p_revision)
 on conflict(inventory_id) do update set fields=excluded.fields,source=excluded.source,based_on_revision=excluded.based_on_revision,created_at=now();
 return jsonb_build_object('description',result->>'description','based_on_revision',p_revision);
end $function$

-- public.studio_rehearse_backup(p_token text, p_document jsonb)
CREATE OR REPLACE FUNCTION public.studio_rehearse_backup(p_token text, p_document jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$

-- public.studio_render_claim(p_token text)
CREATE OR REPLACE FUNCTION public.studio_render_claim(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j studio_core.jobs;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501';end if;
 update studio_core.jobs set state='failed',last_error='Final render lease expired',lease_until=null
 where kind='render' and state='running' and attempts>=3 and lease_until<=now();
 with candidate as (select id from studio_core.jobs where kind='render' and attempts<3
 and ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now()))
 order by available_at,created_at for update skip locked limit 1)
 update studio_core.jobs q set state='running',attempts=q.attempts+1,lease_until=now()+interval '5 minutes'
 from candidate where q.id=candidate.id returning q.* into j;
 if j.id is null then return null;end if;
 return jsonb_build_object('id',j.id,'attempt',j.attempts,'inventory_id',j.inventory_id,'snapshot',j.payload);
end $function$

-- public.studio_render_context(p_job uuid, p_attempt integer, p_token text)
CREATE OR REPLACE FUNCTION public.studio_render_context(p_job uuid, p_attempt integer, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j studio_core.jobs; photos jsonb; credential text;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501';end if;
 select * into strict j from studio_core.jobs where id=p_job and kind='render' and state='running'
 and attempts=p_attempt and lease_until>now();
 select decrypted_secret into credential from vault.decrypted_secrets where name='studio_render_secret';
 if credential is null or length(credential)<64 then raise exception 'Renderer not configured';end if;
 select jsonb_agg(jsonb_build_object('sha256',a.sha256,'bucket',a.bucket,'object_path',a.object_path,'bytes',a.bytes) order by p.ord)
 into photos from jsonb_array_elements(j.payload->'selection') with ordinality p(photo,ord)
 join studio_core.photo_assets a on a.sha256=p.photo->>'sha' and a.cloud_verified_at is not null
 and a.bucket='studio-originals' and a.bytes between 1 and 16000000 where p.photo->>'kind'='real';
 if photos is null or jsonb_array_length(photos)<>jsonb_array_length(j.payload->'selection') then raise exception 'Unverified render source';end if;
 return jsonb_build_object('photos',photos,'endpoint','https://crazymoe-marketplace-studio.vercel.app/api/process_render','secret',credential);
end $function$

-- public.studio_render_finish(p_job uuid, p_attempt integer, p_images jsonb, p_failure text)
CREATE OR REPLACE FUNCTION public.studio_render_finish(p_job uuid, p_attempt integer, p_images jsonb, p_failure text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j studio_core.jobs; a studio_core.listing_authoring; s studio_core.photo_selection;
begin
 -- Match editor lock order before acquiring the job lock to avoid deadlocks.
 select * into strict j from studio_core.jobs where id=p_job and kind='render';
 select * into strict a from studio_core.listing_authoring where inventory_id=j.inventory_id for update;
 select * into strict s from studio_core.photo_selection where inventory_id=j.inventory_id for update;
 select * into strict j from studio_core.jobs where id=p_job for update;
 if j.state<>'running' or j.attempts<>p_attempt or j.lease_until is null or j.lease_until<=now() then raise exception 'Render lease expired';end if;
 if a.revision<>(j.payload->>'listing_revision')::bigint or s.revision<>(j.payload->>'photo_revision')::bigint
 or s.selection is distinct from j.payload->'selection' or s.exports_verified or a.status<>'review'
 or not exists(select 1 from studio_core.inventory where id=j.inventory_id and lifecycle='current')
 or exists(select 1 from studio_core.export_sets where inventory_id=j.inventory_id) then
 update studio_core.jobs set state='failed',last_error='Render snapshot changed',lease_until=null where id=j.id;return false;end if;
 if p_failure is not null then
 update studio_core.jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
 last_error=left(p_failure,200),available_at=now()+interval '5 minutes',lease_until=null where id=j.id;return false;end if;
 if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images)<>jsonb_array_length(s.selection)
 then raise exception 'Incomplete render set';end if;
 -- Trusted worker must upload, download and hash each JPEG before this call.
 if exists(select 1 from jsonb_array_elements(p_images) with ordinality x(i,ord)
 left join storage.objects o on o.bucket_id='studio-originals' and o.name='exports/'||(i->>'sha')
 where coalesce(i->>'sha','') !~ '^[0-9a-f]{64}$' or coalesce((i->>'bytes')::bigint,0) not between 1 and 4000000
 or (o.metadata->>'size')::bigint is distinct from (i->>'bytes')::bigint
 or i->>'width' is distinct from '1600' or i->>'height' is distinct from '1600'
 or i->>'source_sha' is distinct from s.selection->(ord::int-1)->>'sha'
 or i->>'recipe' is distinct from j.payload->>'recipe') then raise exception 'Render receipt mismatch';end if;
 insert into studio_core.export_sets(inventory_id,selection,images) values(j.inventory_id,s.selection,p_images);
 insert into studio_core.photo_choices(inventory_id,position,choice,source,image)
 select j.inventory_id,ord,i->>'sha',s.selection->(ord::int-1),i from jsonb_array_elements(p_images) with ordinality x(i,ord);
 update studio_core.photo_selection set exports_verified=true where inventory_id=j.inventory_id;
 update studio_core.jobs set state='succeeded',last_error=null,lease_until=null where id=j.id;
 return true;
end $function$

-- public.studio_render_status(p_item text)
CREATE OR REPLACE FUNCTION public.studio_render_status(p_item text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a studio_core.listing_authoring; s studio_core.photo_selection; job_state text; job_id uuid; result text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item;
 if coalesce((studio_core.media_health(p_item)->>'export_ready')::boolean,false) then result:='ready';
 else
 select state,id into job_state,job_id from studio_core.jobs where inventory_id=p_item and kind='render'
 and payload->>'listing_revision'=a.revision::text and payload->>'photo_revision'=s.revision::text
 order by created_at desc limit 1;
 result:=case when job_state in ('queued','running') then job_state when job_state='failed' then 'failed'
 when jsonb_array_length(s.selection)=0 then 'needs_photos'
 when jsonb_array_length(s.selection)>10 then 'selection_limit' else 'not_prepared' end;
 end if;
 return jsonb_build_object('state',result,'revision',a.revision,'photo_revision',s.revision,
 'retry_job',case when result='failed' and a.status='review' then job_id else null end);
end $function$

-- public.studio_request_render(p_item text, p_revision bigint, p_photo_revision bigint)
CREATE OR REPLACE FUNCTION public.studio_request_render(p_item text, p_revision bigint, p_photo_revision bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a studio_core.listing_authoring; s studio_core.photo_selection; job_id uuid;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 if a.revision<>p_revision or s.revision<>p_photo_revision then raise exception 'Selection changed' using errcode='40001';end if;
 if a.status<>'review' or not exists(select 1 from studio_core.inventory where id=p_item and lifecycle='current')
 or s.exports_verified or exists(select 1 from studio_core.export_sets where inventory_id=p_item)
 then raise exception 'Use the existing export or current review product';end if;
 if jsonb_array_length(s.selection) not between 1 and 10 then raise exception 'Select one to ten photos';end if;
 -- First production renderer scope: verified inventory originals. Manufacturer and focus rules need their own evidence.
 if exists(select 1 from jsonb_array_elements(s.selection) p left join studio_core.photo_assets f on f.sha256=p->>'sha'
 where p->>'kind' is distinct from 'real' or f.cloud_verified_at is null or f.bytes>16000000
 or coalesce(p->>'style_mode','natural') not in ('natural','blur','brand')) then raise exception 'Unverified render source';end if;
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload)
 values(p_item,'render',p_item||':render:'||p_revision||':'||p_photo_revision,
 jsonb_build_object('listing_revision',p_revision,'photo_revision',p_photo_revision,'selection',s.selection,'requested_by',auth.uid(),'recipe','existing-finish-v4-pop-v1-cloud1'))
 on conflict(idempotency_key) do nothing returning id into job_id;
 if job_id is null then select id into strict job_id from studio_core.jobs where idempotency_key=p_item||':render:'||p_revision||':'||p_photo_revision;end if;
 return job_id;
end $function$

-- public.studio_retry_render(p_item text, p_revision bigint, p_photo_revision bigint, p_failed_job uuid)
CREATE OR REPLACE FUNCTION public.studio_retry_render(p_item text, p_revision bigint, p_photo_revision bigint, p_failed_job uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a studio_core.listing_authoring; s studio_core.photo_selection; j studio_core.jobs; next_id uuid;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 if a.revision<>p_revision or s.revision<>p_photo_revision then raise exception 'Selection changed' using errcode='40001';end if;
 if a.status<>'review' or s.exports_verified or exists(select 1 from studio_core.export_sets where inventory_id=p_item)
 or not exists(select 1 from studio_core.inventory where id=p_item and lifecycle='current') then raise exception 'Render no longer needed';end if;
 select * into strict j from studio_core.jobs where id=p_failed_job and inventory_id=p_item and kind='render' for update;
 if j.state<>'failed' or j.payload->>'listing_revision'<>a.revision::text or j.payload->>'photo_revision'<>s.revision::text
 or j.payload->'selection' is distinct from s.selection then raise exception 'Retry snapshot changed' using errcode='40001';end if;
 select id into next_id from studio_core.jobs where inventory_id=p_item and kind='render' and state in ('queued','running')
 and payload->>'listing_revision'=a.revision::text and payload->>'photo_revision'=s.revision::text order by created_at desc limit 1;
 if next_id is not null then return next_id;end if;
 -- Fresh identity fences late attempts from the failed worker. Never reset its attempts/history.
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload,created_at)
 values(p_item,'render',j.id::text||':retry',j.payload||jsonb_build_object('retry_of',j.id,'requested_by',auth.uid()),clock_timestamp())
 on conflict(idempotency_key) do nothing returning id into next_id;
 if next_id is null then select id into strict next_id from studio_core.jobs where idempotency_key=j.id::text||':retry';end if;
 return next_id;
end $function$

-- public.studio_rollback(p_id text, p_expected_revision bigint, p_event bigint)
CREATE OR REPLACE FUNCTION public.studio_rollback(p_id text, p_expected_revision bigint, p_event bigint)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT studio_core.rollback_fields(p_id,p_expected_revision,p_event); $function$

-- public.studio_save_photo_choices(p_item text, p_listing_revision bigint, p_photo_revision bigint, p_choices text[])
CREATE OR REPLACE FUNCTION public.studio_save_photo_choices(p_item text, p_listing_revision bigint, p_photo_revision bigint, p_choices text[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a studio_core.listing_authoring; s studio_core.photo_selection; e studio_core.export_sets; sources jsonb; files jsonb; old_order text[];
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 select * into strict e from studio_core.export_sets where inventory_id=p_item for update;
 if a.revision is distinct from p_listing_revision or s.revision is distinct from p_photo_revision
 or e.selection is distinct from s.selection or not s.exports_verified then raise exception 'Selection changed' using errcode='40001'; end if;
 if a.status not in ('review','approved') then raise exception 'Product cannot be edited';end if;
 if coalesce(cardinality(p_choices),0) not between 1 and 10 or (select count(distinct v) from unnest(p_choices)v)<>cardinality(p_choices)
 then raise exception 'Select one to ten different photos';end if;
 select jsonb_agg(c.source order by pos),jsonb_agg(c.image order by pos) into sources,files
 from unnest(p_choices) with ordinality u(choice,pos)
 join studio_core.photo_choices c on c.inventory_id=p_item and c.choice=u.choice;
 if jsonb_array_length(files) is distinct from cardinality(p_choices) then raise exception 'Unverified photo choice';end if;
 if files=e.images and sources=e.selection then return s.revision;end if;
 select array_agg(i.image->>'sha' order by pos) into old_order from jsonb_array_elements(e.images) with ordinality i(image,pos);
 insert into studio_core.photo_changes(inventory_id,revision,before_order,after_order,listing_revision,actor)
 values(p_item,s.revision+1,old_order,p_choices,a.revision,auth.uid());
 update studio_core.photo_selection set selection=sources,revision=s.revision+1 where inventory_id=p_item;
 update studio_core.export_sets set selection=sources,images=files,verified_at=now() where inventory_id=p_item;
 if a.status='approved' then
  insert into studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
  values(p_item,'invalidated',a.revision,jsonb_build_object('reason','photo_selection','photo_revision',s.revision+1),auth.uid());
  update studio_core.listing_authoring set status='review',updated_at=now() where inventory_id=p_item;
 end if;
 return s.revision+1;
end $function$

-- public.studio_seller_patch(p_id text, p_expected_revision bigint, p_patch jsonb)
CREATE OR REPLACE FUNCTION public.studio_seller_patch(p_id text, p_expected_revision bigint, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT studio_core.seller_patch(p_id,p_expected_revision,p_patch); $function$

-- public.studio_state()
CREATE OR REPLACE FUNCTION public.studio_state()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT studio_core.read_state(); $function$

-- public.studio_sync_observations(p_account text, p_mode text, p_rows jsonb)
CREATE OR REPLACE FUNCTION public.studio_sync_observations(p_account text, p_mode text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare observation jsonb; listing_id text; legacy_id bigint; matched integer:=0; pending integer:=0;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_account is null or p_account !~ '^[a-zA-Z0-9_-]{1,64}$' or p_mode is null or p_mode not in ('full','new_only','availability_refresh')
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50
 or octet_length(p_rows::text)>1000000 then raise exception 'Invalid observation batch'; end if;
 for observation in select value from jsonb_array_elements(p_rows) order by value->>'facebook_id' loop
  listing_id:=observation->>'facebook_id';
  if listing_id is null or listing_id !~ '^[0-9]{10,19}$' or observation->>'account_tag' is distinct from p_account
  then raise exception 'Invalid listing or account'; end if;
  select id into legacy_id from public.active_listings where account_tag=p_account and facebook_id=listing_id;
  if legacy_id is not null then
   matched:=matched+1;
   if p_mode='new_only' then continue; end if;
  else
   if p_mode='availability_refresh' then continue; end if;
   pending:=pending+1;
  end if;
  insert into studio_core.facebook_observations values(p_account,listing_id,statement_timestamp(),auth.uid(),observation)
  on conflict(account_tag,facebook_id) do update set observed_at=excluded.observed_at,observed_by=excluded.observed_by,evidence=excluded.evidence
  where facebook_observations.observed_at<=excluded.observed_at;
  if legacy_id is not null then
   update public.active_listings set last_seen_at=statement_timestamp()
   where id=legacy_id and (last_seen_at is null or last_seen_at<statement_timestamp());
  end if;
 end loop;
 return jsonb_build_object('matched',matched,'pending',pending);
end $function$

-- public.studio_worker_claim(p_token text)
CREATE OR REPLACE FUNCTION public.studio_worker_claim(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job studio_core.jobs; result jsonb;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501'; end if;
 update studio_core.jobs set state='failed',last_error='Final worker lease expired'
 where kind='identify' and state='running' and attempts>=3 and lease_until<=now();
 with next_job as (
 select id from studio_core.jobs where kind='identify' and attempts<3
 and ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now()))
 order by available_at,created_at for update skip locked limit 1)
 update studio_core.jobs j set state='running',attempts=j.attempts+1,lease_until=now()+interval '4 minutes'
 from next_job where j.id=next_job.id returning j.* into job;
 if job.id is null then return null; end if;
 select jsonb_build_object('id',job.id,'attempt',job.attempts,'revision',a.revision,
 'photos',coalesce((select jsonb_agg(to_jsonb(t)) from (
 select asset.bucket,asset.object_path,asset.sha256,asset.bytes
 from jsonb_array_elements(s.selection) with ordinality as x(photo,ord)
 join studio_core.photo_assets asset on asset.sha256=photo->>'sha' and asset.cloud_verified_at is not null
 where photo->>'kind'='real' and asset.bytes<=16000000 order by ord limit 2) t),'[]'::jsonb))
 into result from studio_core.listing_authoring a join studio_core.photo_selection s using(inventory_id)
 where a.inventory_id=job.inventory_id;
 return result;
end $function$

-- public.studio_worker_finish(p_job uuid, p_attempt integer, p_revision bigint, p_evidence jsonb, p_failure text)
CREATE OR REPLACE FUNCTION public.studio_worker_finish(p_job uuid, p_attempt integer, p_revision bigint, p_evidence jsonb, p_failure text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job studio_core.jobs;
begin
 select * into strict job from studio_core.jobs where id=p_job for update;
 if job.state<>'running' or job.attempts<>p_attempt or job.lease_until<now() then raise exception 'Worker lease expired'; end if;
 if p_failure is not null then
  update studio_core.jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
   last_error=left(p_failure,250),available_at=now()+interval '5 minutes',lease_until=null where id=p_job;
 else
  insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence)
  values(job.inventory_id,coalesce(p_evidence->'suggestion','{}'),p_revision,'cloud_visual_research',p_evidence);
  update studio_core.jobs set state='succeeded',lease_until=null,last_error=null where id=p_job;
 end if;
end $function$

-- studio_core.mercari_catalog(p_action text, p_items jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_catalog(p_action text DEFAULT 'state'::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); i jsonb; src jsonb;
begin
 if actor is null or not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>5000 then raise exception 'Invalid selection'; end if;
 if p_action in ('keep','keep_only','exclude') then
  if jsonb_array_length(p_items)=0 then raise exception 'Select products first'; end if;
  -- Serialize edits to one owner’s shortlist across devices.
  insert into studio_core.mercari_catalog_settings(owner_id,enabled) values(actor,true) on conflict(owner_id) do nothing;
  perform 1 from studio_core.mercari_catalog_settings where owner_id=actor for update;
  update studio_core.mercari_catalog_settings set enabled=true where owner_id=actor;
  if p_action='keep_only' then update studio_core.mercari_catalog_choices set included=false,updated_at=now() where owner_id=actor; end if;
  for i in select value from jsonb_array_elements(p_items) loop
   src:=studio_core.mercari_source(i->>'source_kind',i->>'source_id');
   if src is null or (p_action<>'exclude' and not coalesce((src->>'available')::boolean,false)) then raise exception 'Selected product is unavailable'; end if;
   insert into studio_core.mercari_catalog_choices(owner_id,source_kind,source_id,included)
   values(actor,i->>'source_kind',i->>'source_id',p_action<>'exclude')
   on conflict(owner_id,source_kind,source_id) do update set included=excluded.included,updated_at=now();
  end loop;
  update studio_core.mercari_shipping_research j set state='cancelled',lease=null,lease_until=null,updated_at=now()
  where j.owner_id=actor and j.state in ('queued','running') and not exists(select 1 from studio_core.mercari_catalog_choices c where c.owner_id=actor and c.source_kind=j.source_kind and c.source_id=j.source_id and c.included);
 elsif p_action in ('research','retry_research') then
  if not exists(select 1 from studio_core.mercari_catalog_choices where owner_id=actor and included) then raise exception 'Save your Mercari selection first'; end if;
  for i in select to_jsonb(c) from studio_core.mercari_catalog_choices c where c.owner_id=actor and included loop
   src:=studio_core.mercari_source(i->>'source_kind',i->>'source_id');
   if coalesce((src->>'available')::boolean,false) then
    insert into studio_core.mercari_shipping_research(owner_id,source_kind,source_id,source_digest,title)
    values(actor,i->>'source_kind',i->>'source_id',src->>'digest',coalesce(src#>>'{fields,title}',src#>>'{suggestions,title}',''))
    on conflict(owner_id,source_kind,source_id) do update set state='queued',source_digest=excluded.source_digest,title=excluded.title,result='{}',attempts=0,updated_at=now()
    where mercari_shipping_research.source_digest<>excluded.source_digest or mercari_shipping_research.state in ('error','cancelled') or (p_action='retry_research' and mercari_shipping_research.state='needs_review');
   end if;
  end loop;
 elsif p_action<>'state' then raise exception 'Unknown catalog action'; end if;
 return jsonb_build_object('enabled',coalesce((select enabled from studio_core.mercari_catalog_settings where owner_id=actor),false),
 'choices',coalesce((select jsonb_agg(jsonb_build_object('source_kind',source_kind,'source_id',source_id,'included',included)) from studio_core.mercari_catalog_choices where owner_id=actor),'[]'),
 'audit',jsonb_build_object('old_ids',coalesce((select jsonb_agg(id::text) from public.active_listings where is_active and status='active' and coalesce(last_seen_at,'epoch')<now()-interval '14 days'),'[]'),'duplicate_ids',coalesce((select jsonb_agg(id::text) from (select id,count(*) over(partition by lower(regexp_replace(title,'[^a-zA-Z0-9]','','g'))) n from public.active_listings where is_active and status='active')d where n>1),'[]'),'duplicate_groups',(select count(*) from (select lower(regexp_replace(title,'[^a-zA-Z0-9]','','g')) from public.active_listings where is_active and status='active' group by 1 having count(*)>1)d)),
 'worker_seen_at',(select max(last_seen_at) from studio_core.mercari_research_workers where owner_id=actor),
 'research',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source_kind',source_kind,'source_id',source_id,'state',state,'source_digest',source_digest,'result',result,'updated_at',updated_at)) from studio_core.mercari_shipping_research where owner_id=actor),'[]'));
end $function$

-- studio_core.mercari_categories(p_paths jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_categories(p_paths jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare paths jsonb; result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if p_paths is not null then
  if jsonb_typeof(p_paths)<>'array' or jsonb_array_length(p_paths)>6000 or octet_length(p_paths::text)>2000000 then raise exception 'Invalid category import';end if;
  if exists(select 1 from jsonb_array_elements(p_paths) p where jsonb_typeof(p)<>'array' or jsonb_array_length(p) not between 1 and 6)
  or exists(select 1 from jsonb_array_elements(p_paths) p cross join lateral jsonb_array_elements(p) v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200)
  then raise exception 'Invalid category path';end if;
  select coalesce(jsonb_agg(path order by path::text),'[]') into paths from (
   select distinct value as path from jsonb_array_elements(p_paths||coalesce((select t.paths from studio_core.mercari_taxonomy t where owner_id=auth.uid()),'[]'))
  ) x;
  insert into studio_core.mercari_taxonomy(owner_id,paths) values(auth.uid(),paths)
  on conflict(owner_id) do update set paths=excluded.paths,updated_at=now();
 end if;
 select jsonb_build_object('paths',t.paths,'updated_at',t.updated_at) into result from studio_core.mercari_taxonomy t where owner_id=auth.uid();
 return coalesce(result,'{"paths":[]}'::jsonb);
end $function$

-- studio_core.mercari_finish_recovery(p_user uuid, p_id uuid, p_revision integer, p_batch uuid, p_files jsonb, p_description text, p_condition text)
CREATE OR REPLACE FUNCTION studio_core.mercari_finish_recovery(p_user uuid, p_id uuid, p_revision integer, p_batch uuid, p_files jsonb, p_description text, p_condition text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q studio_core.mercari_queue;src jsonb;f jsonb;photo jsonb;added jsonb:='[]';combined jsonb;rec studio_core.mercari_import_recovery;path text;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from studio_core.members where user_id=p_user and enabled) then raise exception 'Studio access denied' using errcode='42501';end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)>12 or length(p_description)>20000 or p_condition not in ('','New','Like new','Good','Fair','Poor') then raise exception 'Invalid recovery';end if;
 select * into strict q from studio_core.mercari_queue where id=p_id and owner_id=p_user for update;
 if q.revision is distinct from p_revision then raise exception 'Queue item changed' using errcode='40001';end if;
 if q.source_kind<>'imported' or q.state not in ('ready','needs_details') then raise exception 'Only open imported items can be recovered';end if;
 if not exists(select 1 from public.active_listings where id=q.source_id::bigint and is_active and status='active' and coalesce(quantity,1)>0) then raise exception 'Source unavailable';end if;
 select * into rec from studio_core.mercari_import_recovery where source_id=q.source_id::bigint for update;
 for f in select value from jsonb_array_elements(p_files) loop
  if coalesce(f->>'sha','') !~ '^[a-f0-9]{64}$' or coalesce(f->>'bytes','') !~ '^[0-9]+$' or (f->>'bytes')::bigint not between 1 and 16000000 then raise exception 'Invalid recovery photo';end if;
  path:='incoming/'||p_user||'/'||p_batch||'/'||(f->>'sha');
  if not exists(select 1 from storage.objects where bucket_id='studio-originals' and name=path and (metadata->>'size')::bigint=(f->>'bytes')::bigint) then raise exception 'Recovery upload unavailable';end if;
  insert into studio_core.photo_assets(sha256,bucket,object_path,bytes,cloud_verified_at,source_metadata)
  values(f->>'sha','studio-originals',path,(f->>'bytes')::bigint,now(),jsonb_build_object('recovery_source_id',q.source_id,'verified_by','studio-mercari-recovery')) on conflict(sha256) do nothing;
  if not exists(select 1 from studio_core.photo_assets where sha256=f->>'sha' and cloud_verified_at is not null and bytes=(f->>'bytes')::bigint) then raise exception 'Existing photo is not verified';end if;
  photo:=jsonb_build_object('sha',f->>'sha','bytes',(f->>'bytes')::bigint,'name',f->>'name','kind','original');
  if not exists(select 1 from jsonb_array_elements(coalesce(rec.photos,'[]')||added) p where p->>'sha'=f->>'sha') then added:=added||jsonb_build_array(photo);end if;
 end loop;
 combined:=coalesce(rec.photos,'[]')||added;
 if jsonb_array_length(combined)>12 or jsonb_array_length(q.draft->'photos')+jsonb_array_length(added)>12 then raise exception 'Select at most 12 photos';end if;
 insert into studio_core.mercari_import_recovery(source_id,description,condition,photos,recovered_by)
 values(q.source_id::bigint,coalesce(nullif(p_description,''),rec.description,''),coalesce(nullif(p_condition,''),rec.condition,''),combined,p_user)
 on conflict(source_id) do update set description=excluded.description,condition=excluded.condition,photos=excluded.photos,recovered_by=excluded.recovered_by,recovered_at=now();
 -- Source access checks use the verified member, never a browser-supplied user ID.
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 q.draft:=jsonb_set(q.draft,'{photos}',(q.draft->'photos')||added);
 perform studio_core.mercari_validate(q.draft,src);
 update studio_core.mercari_queue set draft=q.draft,source_snapshot=src,source_digest=src->>'digest',revision=revision+1,updated_at=now(),
 state=case when studio_core.mercari_issues(q.draft,src)='[]'::jsonb then 'ready' else 'needs_details' end where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,p_user,'source_recovered',q.revision,jsonb_build_object('photos_added',jsonb_array_length(added),'description_recovered',length(p_description)>0,'original_description',coalesce(rec.description,''),'recovered_description',p_description,'added_photos',added,'source_digest',src->>'digest'));
 return jsonb_build_object('id',q.id,'revision',q.revision,'photos_added',jsonb_array_length(added));
end $function$

-- studio_core.mercari_handoff(p_id uuid, p_revision integer, p_event text, p_details jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_handoff(p_id uuid, p_revision integer, p_event text, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q studio_core.mercari_queue;src jsonb;link text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if coalesce(p_event,'') not in ('filled','needs_attention','error','published') or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>10000 then raise exception 'Invalid fill result';end if;
 select * into strict q from studio_core.mercari_queue where id=p_id and owner_id=auth.uid() for update;
 if q.revision is distinct from p_revision then raise exception 'Listing changed while the Mercari form was open' using errcode='40001';end if;
 if q.state not in ('ready','needs_details') then raise exception 'This listing is already closed';end if;
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 if p_event<>'error' and (src is null or not coalesce((src->>'available')::boolean,false) or src->>'digest' is distinct from q.source_digest)
 then raise exception 'Inventory changed during the Mercari handoff' using errcode='40001';end if;
 if p_event='published' then
  if coalesce(p_details->>'url','') !~ '^https://www[.]mercari[.]com/us/item/m[0-9]+/?$' then raise exception 'Invalid Mercari listing link';end if;
  link:='https://www.mercari.com/us/item/'||substring(p_details->>'url' from '/us/item/(m[0-9]+)')||'/';
  q.state:='posted';q.listing_url:=link;q.revision:=q.revision+1;
 end if;
 update studio_core.mercari_queue set state=q.state,listing_url=q.listing_url,revision=q.revision,
 handoff=jsonb_build_object('state',p_event,'details',p_details,'recorded_at',now()),updated_at=now() where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,auth.uid(),'browser_'||p_event,q.revision,p_details);
 return to_jsonb(q);
end $function$

-- studio_core.mercari_inventory(p_kind text, p_query text, p_offset integer, p_limit integer)
CREATE OR REPLACE FUNCTION studio_core.mercari_inventory(p_kind text, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 200 or length(p_query)>200 or p_kind not in ('all','studio','imported') then raise exception 'Invalid inventory page'; end if;
 with ids as (
 select 'studio'::text source_kind,i.id from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
 where p_kind in ('all','studio') and i.lifecycle='current' and a.status<>'archived'
 and (p_kind<>'all' or a.status='listed')
 and (p_query='' or position(lower(p_query) in lower(a.fields::text||i.id))>0)
 union all
 select 'imported'::text source_kind,a.id::text from public.active_listings a
 where p_kind in ('all','imported') and a.is_active and a.status='active' and coalesce(a.quantity,1)>0
 and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)
 ), page as (select source_kind,id from ids order by source_kind,id limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from ids),'items',coalesce((select jsonb_agg(studio_core.mercari_source(source_kind,id) order by source_kind,id) from page),'[]'::jsonb)) into result;
 return result;
end $function$

-- studio_core.mercari_issues(p_draft jsonb, p_source jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_issues(p_draft jsonb, p_source jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare issues jsonb:='[]'; s jsonb:=p_draft->'shipping'; k text;
begin
 if p_source is null or not coalesce((p_source->>'available')::boolean,false) then issues:=issues||'"Product is no longer available in inventory"'::jsonb; end if;
 if coalesce(trim(p_draft->>'title'),'')='' then issues:=issues||'"Add a title"'::jsonb; end if;
 if length(coalesce(p_draft->>'title',''))>80 then issues:=issues||'"Shorten the title to 80 characters"'::jsonb; end if;
 if coalesce(trim(p_draft->>'description'),'')='' then issues:=issues||'"Add a description"'::jsonb; end if;
 if length(coalesce(p_draft->>'description',''))>1000 then issues:=issues||'"Shorten the description to 1,000 characters"'::jsonb; end if;
 if coalesce(p_draft->>'price','') !~ '^[0-9]{1,4}([.][0-9]{1,2})?$' then issues:=issues||'"Set a price from $1 to $2,000"'::jsonb;
 elsif (p_draft->>'price')::numeric not between 1 and 2000 then issues:=issues||'"Set a price from $1 to $2,000"'::jsonb; end if;
 if coalesce(p_draft->>'condition','') not in ('New','Like new','Good','Fair','Poor') then issues:=issues||'"Choose a Mercari condition"'::jsonb; end if;
 if coalesce(trim(p_draft->>'category'),'')='' then issues:=issues||'"Choose the Mercari category"'::jsonb; end if;
 if coalesce(trim(p_draft->>'brand'),'')='' then issues:=issues||'"Enter the brand, or No brand"'::jsonb; end if;
 if coalesce(jsonb_array_length(p_draft->'photos'),0) not between 1 and 12 then issues:=issues||'"Select 1 to 12 product photos"'::jsonb; end if;
 if coalesce(s->>'payer','') not in ('buyer','seller') then issues:=issues||'"Choose who pays shipping"'::jsonb; end if;
 for k in select unnest(array['weight_oz','length_in','width_in','height_in']) loop
  if coalesce(s->>k,'') !~ '^[0-9]{1,5}([.][0-9]{1,2})?$' then issues:=issues||to_jsonb('Enter packed '||replace(k,'_',' '));
  elsif (s->>k)::numeric<=0 then issues:=issues||to_jsonb('Enter positive packed '||replace(k,'_',' ')); end if;
 end loop;
 return issues;
end $function$

-- studio_core.mercari_prepare(p_rows jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_prepare(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare row jsonb; src jsonb; q studio_core.mercari_queue; result jsonb:='[]'; issues jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Select 1 to 50 products'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  src:=studio_core.mercari_source(row->>'source_kind',row->>'source_id');
  if src is null or not coalesce((src->>'available')::boolean,false) then raise exception 'Product no longer available'; end if;
  if src->>'digest' is distinct from row->>'digest' then raise exception 'Inventory changed. Refresh before preparing.' using errcode='40001'; end if;
  perform studio_core.mercari_validate(row->'draft',src);
  issues:=studio_core.mercari_issues(row->'draft',src);
  insert into studio_core.mercari_queue(owner_id,source_kind,source_id,source_digest,source_snapshot,draft,state)
  values(auth.uid(),row->>'source_kind',row->>'source_id',src->>'digest',src,row->'draft',case when issues='[]'::jsonb then 'ready' else 'needs_details' end)
  on conflict(owner_id,source_kind,source_id) do nothing returning * into q;
  if q.id is not null then
   insert into studio_core.mercari_events(queue_id,actor,event,revision) values(q.id,auth.uid(),'prepared',q.revision);
   result:=result||jsonb_build_object('id',q.id,'created',true);
  else
   select * into strict q from studio_core.mercari_queue where owner_id=auth.uid() and source_kind=row->>'source_kind' and source_id=row->>'source_id';
   result:=result||jsonb_build_object('id',q.id,'created',false);
  end if;
 end loop;
 return result;
end $function$

-- studio_core.mercari_preset(p_name text, p_shipping jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_preset(p_name text, p_shipping jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if length(trim(p_name)) not between 1 and 80 or jsonb_typeof(p_shipping) is distinct from 'object' or octet_length(p_shipping::text)>500 then raise exception 'Enter a preset name and packed measurements'; end if;
 if exists(select 1 from jsonb_array_elements_text(studio_core.mercari_issues(jsonb_build_object('shipping',p_shipping),'{}')) x where x like '%packed %' or x='Choose who pays shipping') then raise exception 'Complete the packed weight, dimensions and shipping payer'; end if;
 insert into studio_core.mercari_presets(owner_id,name,shipping) values(auth.uid(),trim(p_name),p_shipping)
 on conflict(owner_id,name) do update set shipping=excluded.shipping,revision=studio_core.mercari_presets.revision+1
 returning to_jsonb(mercari_presets)-'owner_id' into result;
 return result;
end $function$

-- studio_core.mercari_research_work(p_token text, p_action text, p_id uuid, p_lease uuid, p_result jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_research_work(p_token text, p_action text, p_id uuid DEFAULT NULL::uuid, p_lease uuid DEFAULT NULL::uuid, p_result jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; j studio_core.mercari_shipping_research; s jsonb; q studio_core.mercari_queue; d jsonb; k text; shipping jsonb; complete boolean; e jsonb; prior_claims text:=current_setting('request.jwt.claims',true);
begin
 if length(p_token)<>64 then raise exception 'Worker denied' using errcode='42501'; end if;
 update studio_core.mercari_research_workers set last_seen_at=now() where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') returning owner_id into actor;
 if actor is null then raise exception 'Worker denied' using errcode='42501'; end if;
 if p_action='claim' then
  update studio_core.mercari_shipping_research set state='error',lease=null,lease_until=null,updated_at=now(),result=result||jsonb_build_object('summary','Research stopped after three interrupted attempts. Click Research shipping to retry.')
  where owner_id=actor and attempts>=3 and (state='queued' or (state='running' and lease_until<now()));
  select * into j from studio_core.mercari_shipping_research r where r.owner_id=actor and (r.state='queued' or (r.state='running' and r.lease_until<now())) and r.attempts<3
   and exists(select 1 from studio_core.mercari_catalog_choices c where c.owner_id=actor and c.source_kind=r.source_kind and c.source_id=r.source_id and c.included)
   order by r.created_at for update skip locked limit 1;
  if j.id is null then return jsonb_build_object('job',null); end if;
  update studio_core.mercari_shipping_research set state='running',lease=gen_random_uuid(),lease_until=now()+interval '20 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('job',jsonb_build_object('id',j.id,'lease',j.lease,'title',j.title,'source_kind',j.source_kind,'source_id',j.source_id));
 elsif p_action='finish' then
  select * into j from studio_core.mercari_shipping_research where id=p_id and owner_id=actor and state='running' and lease=p_lease and lease_until>now() for update;
  if j.id is null then raise exception 'Research lease expired'; end if;
  if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>50000 then raise exception 'Invalid research result'; end if;
  shipping:=p_result->'shipping';complete:=coalesce((p_result->>'exact_model')::boolean,false) and p_result->>'basis'='packaged' and jsonb_array_length(coalesce(p_result->'evidence','[]'))>0;
  for e in select value from jsonb_array_elements(coalesce(p_result->'evidence','[]')) loop
   if coalesce(e->>'url','') !~ '^https://[^/ ]+' then complete:=false; end if;
  end loop;
  for k in select unnest(array['weight_oz','length_in','width_in','height_in']) loop
   if coalesce(shipping->>k,'') !~ '^[0-9]{1,5}([.][0-9]{1,2})?$' then complete:=false;
   elsif (shipping->>k)::numeric<=0 then complete:=false; end if;
  end loop;
  -- Status may have changed while online research was running.
  if not exists(select 1 from studio_core.mercari_catalog_choices where owner_id=actor and source_kind=j.source_kind and source_id=j.source_id and included) then
   update studio_core.mercari_shipping_research set state='cancelled',lease=null,lease_until=null where id=j.id; return jsonb_build_object('state','cancelled');
  end if;
  -- Read as owner for the existing source/member guards.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  s:=studio_core.mercari_source(j.source_kind,j.source_id);
  perform set_config('request.jwt.claims',coalesce(prior_claims,'{}'),true);
  if s->>'digest' is distinct from j.source_digest or not coalesce((s->>'available')::boolean,false) then complete:=false;p_result:=p_result||jsonb_build_object('summary','Source changed during research. Re-run after reviewing the current product.'); end if;
  update studio_core.mercari_shipping_research set state=case when complete then 'complete' else 'needs_review' end,result=p_result,lease=null,lease_until=null,updated_at=now() where id=j.id returning * into j;
  if complete then
   select * into q from studio_core.mercari_queue where owner_id=actor and source_kind=j.source_kind and source_id=j.source_id and state in ('ready','needs_details') and source_digest=j.source_digest for update;
   if q.id is not null then
    d:=q.draft;
    for k in select unnest(array['weight_oz','length_in','width_in','height_in']) loop
     if coalesce(d#>>array['shipping',k],'')='' then d:=jsonb_set(d,array['shipping',k],to_jsonb(shipping->>k)); end if;
    end loop;
    update studio_core.mercari_queue set draft=d,revision=revision+1,updated_at=now(),state=case when jsonb_array_length(studio_core.mercari_issues(d,s))=0 then 'ready' else 'needs_details' end where id=q.id;
    insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,actor,'shipping_researched',q.revision+1,jsonb_build_object('research_id',j.id));
   end if;
  end if;
  return jsonb_build_object('id',j.id,'state',j.state);
 else raise exception 'Unknown worker action'; end if;
end $function$

-- studio_core.mercari_source(p_kind text, p_id text)
CREATE OR REPLACE FUNCTION studio_core.mercari_source(p_kind text, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_kind='studio' then
  select jsonb_build_object('source_kind','studio','source_id',i.id,'revision',a.revision,
   'available',i.lifecycle='current' and a.status<>'archived','identity_status',p.verification_status,
   'fields',a.fields,'suggestions',g.fields,
   'brand',coalesce(a.fields->>'brand',p.identity->>'brand',''),
   'photos',coalesce((select jsonb_agg(v.photo order by v.pos) from (
    select distinct on (x.photo->>'sha') x.pos,jsonb_build_object('sha',f.sha256,'bytes',f.bytes,'name',coalesce(x.photo->>'name','photo.jpg'),'kind','original') photo
    from jsonb_array_elements(coalesce(s.selection,'[]')) with ordinality x(photo,pos)
    join studio_core.photo_assets f on f.sha256=x.photo->>'sha' and f.cloud_verified_at is not null
    where x.photo->>'kind'='real' and f.bytes<=16000000 order by x.photo->>'sha',x.pos
   ) v),'[]'::jsonb)) into result
  from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
  left join studio_core.product_identity p on p.inventory_id=i.id
  left join studio_core.generated_copy g on g.inventory_id=i.id
  left join studio_core.photo_selection s on s.inventory_id=i.id where i.id=p_id;
 elsif p_kind='imported' then
  select jsonb_build_object('source_kind','imported','source_id',a.id::text,
   'available',a.is_active and a.status='active' and coalesce(a.quantity,1)>0,
   'fields',jsonb_build_object('title',a.title,'description',coalesce(nullif(a.description,''),nullif(m.description,''),nullif(rec.description,'')),'price',a.price,'condition',coalesce(nullif(a.condition,''),nullif(m.condition,''),nullif(rec.condition,'')),'category',coalesce(nullif(a.category,''),m.category)),
   'brand',coalesce(a.metadata->>'brand',''),'facebook_id',a.facebook_id,'quantity',a.quantity,
   'photos',coalesce((select jsonb_agg(jsonb_build_object('url',v.url,'kind','imported') order by v.pos) from (
    select distinct on (x.url) x.url,x.pos from jsonb_array_elements_text(coalesce(to_jsonb(a.images),'[]')||coalesce(m.images,'[]')) with ordinality x(url,pos)
    where starts_with(x.url,'https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/')
    order by x.url,x.pos) v),'[]'::jsonb)||coalesce(rec.photos,'[]'::jsonb)) into result
  from public.active_listings a left join studio_core.mercari_import_recovery rec on rec.source_id=a.id left join lateral (select b.description,b.condition,b.category,b.images from public.marketplace_listings b where b.facebook_id=a.facebook_id and b.account_tag=a.account_tag order by b.updated_at desc nulls last limit 1) m on true where a.id::text=p_id;
 else raise exception 'Unknown inventory source'; end if;
 if result is null then return null; end if;
 return result||jsonb_build_object('digest',md5(result::text));
end $function$

-- studio_core.mercari_state()
CREATE OR REPLACE FUNCTION studio_core.mercari_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 return jsonb_build_object('queue',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object(
  'stale',s.data->>'digest' is distinct from q.source_digest,
  'available',coalesce((s.data->>'available')::boolean,false),'issues',studio_core.mercari_issues(q.draft,s.data)) order by q.created_at,q.id)
  from studio_core.mercari_queue q left join lateral(select studio_core.mercari_source(q.source_kind,q.source_id) data) s on true
  where q.owner_id=auth.uid()),'[]'::jsonb),
 'presets',coalesce((select jsonb_agg(to_jsonb(p)-'owner_id' order by p.name) from studio_core.mercari_presets p where p.owner_id=auth.uid()),'[]'::jsonb));
end $function$

-- studio_core.mercari_update(p_id uuid, p_revision integer, p_action text, p_draft jsonb, p_url text)
CREATE OR REPLACE FUNCTION studio_core.mercari_update(p_id uuid, p_revision integer, p_action text, p_draft jsonb DEFAULT NULL::jsonb, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q studio_core.mercari_queue; src jsonb; issues jsonb; url text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into q from studio_core.mercari_queue where id=p_id and owner_id=auth.uid() for update;
 if q.id is null then raise exception 'Queue item unavailable' using errcode='42501'; end if;
 if q.revision is distinct from p_revision then raise exception 'This queue item changed on another device. Refresh before saving.' using errcode='40001'; end if;
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 if p_action in ('save','rebuild','posted','download') then
  if src is null or not coalesce((src->>'available')::boolean,false) then raise exception 'Product is no longer available in inventory'; end if;
  if p_action<>'rebuild' and src->>'digest' is distinct from q.source_digest then raise exception 'Source changed. Refresh this item from inventory first.' using errcode='40001'; end if;
 end if;
 if p_action in ('save','rebuild') then
  if q.state not in ('needs_details','ready','cancelled') then raise exception 'Posted or sold items cannot be rebuilt'; end if;
  if p_action='save' and q.state='cancelled' then raise exception 'Rebuild this cancelled item first'; end if;
  perform studio_core.mercari_validate(p_draft,src);
  issues:=studio_core.mercari_issues(p_draft,src);
  q.draft:=p_draft; q.state:=case when issues='[]'::jsonb then 'ready' else 'needs_details' end;
  q.source_snapshot:=src;q.source_digest:=src->>'digest';
 elsif p_action='posted' then
  if q.state not in ('ready','needs_details') then raise exception 'Only an open listing can be marked posted'; end if;
  if coalesce(p_url,'') !~ '^https://(www[.])?mercari[.]com/us/item/m[0-9]+/?([?#].*)?$' then raise exception 'Paste the published Mercari item link'; end if;
  url:='https://www.mercari.com/us/item/'||substring(p_url from '/us/item/(m[0-9]+)')||'/';
  q.listing_url:=url;q.state:='posted';
 elsif p_action='sold' then
  if q.state not in ('ready','posted','needs_details') then raise exception 'This item is already closed'; end if;
  q.state:='sold';
 elsif p_action='cancel' then
  if q.state not in ('needs_details','ready') then raise exception 'Only unposted queue items can be cancelled'; end if;
  q.state:='cancelled';
 elsif p_action='download' then
  if q.state not in ('needs_details','ready','posted') then raise exception 'This queue item is closed'; end if;
  return to_jsonb(q);
 else raise exception 'Unknown queue action'; end if;
 update studio_core.mercari_queue set draft=q.draft,state=q.state,source_snapshot=q.source_snapshot,source_digest=q.source_digest,
 listing_url=q.listing_url,revision=revision+1,updated_at=now() where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,auth.uid(),p_action,q.revision,
  jsonb_build_object('state',q.state,'listing_url',q.listing_url));
 return to_jsonb(q);
end $function$

-- studio_core.mercari_validate(p_draft jsonb, p_source jsonb)
CREATE OR REPLACE FUNCTION studio_core.mercari_validate(p_draft jsonb, p_source jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare photo jsonb; k text;
begin
 if jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>30000
 or jsonb_typeof(p_draft->'photos') is distinct from 'array' or jsonb_array_length(p_draft->'photos')>12
 or jsonb_typeof(p_draft->'shipping') is distinct from 'object' then raise exception 'Invalid prepared listing'; end if;
 for k in select jsonb_object_keys(p_draft) loop
  if k not in ('title','description','price','condition','category','brand','shipping','photos','photos_confirmed') then raise exception 'Unknown listing field'; end if;
 end loop;
 foreach k in array array['title','description','price','condition','category','brand'] loop
  if jsonb_typeof(p_draft->k) is distinct from 'string' then raise exception 'Invalid listing field: %',k; end if;
 end loop;
 if length(p_draft->>'title')>200 or length(p_draft->>'description')>20000 or length(p_draft->>'brand')>200 or length(p_draft->>'category')>500
 or length(p_draft->>'price')>20 then raise exception 'Listing field too long'; end if;
 if jsonb_typeof(p_draft->'photos_confirmed') is distinct from 'boolean' then raise exception 'Confirm the photo source'; end if;
 if (select count(distinct value) from jsonb_array_elements(p_draft->'photos'))<>jsonb_array_length(p_draft->'photos') then raise exception 'Duplicate photo'; end if;
 for photo in select value from jsonb_array_elements(p_draft->'photos') loop
  if not coalesce((p_source->'photos') @> jsonb_build_array(photo),false) then raise exception 'Photo does not belong to this source'; end if;
 end loop;
 if jsonb_typeof(p_draft->'shipping'->'payer') is distinct from 'string' then raise exception 'Invalid shipping'; end if;
 for k in select jsonb_object_keys(p_draft->'shipping') loop
  if k not in ('payer','weight_oz','length_in','width_in','height_in') or jsonb_typeof(p_draft->'shipping'->k) is distinct from 'string'
  or length(p_draft->'shipping'->>k)>20 then raise exception 'Invalid shipping field'; end if;
 end loop;
end $function$

-- studio_core.studio_posting_accounts(p_label text, p_profile text, p_tag text)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_accounts(p_label text DEFAULT NULL::text, p_profile text DEFAULT NULL::text, p_tag text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_label is not null then
  if length(trim(p_label)) not between 1 and 100 or p_profile is null or p_profile !~ '^[0-9]{5,25}$'
    or p_tag is null or p_tag !~ '^[a-zA-Z0-9_-]{1,64}$'
    or exists(select 1 from public.active_listings where account_tag=p_tag)
  then raise exception 'Use a new account tag, seller name, and numeric Facebook profile ID'; end if;
  insert into studio_core.posting_accounts(owner_id,label,profile_id,account_tag)
  values(auth.uid(),trim(p_label),p_profile,p_tag)
  on conflict(owner_id,profile_id) do update set label=excluded.label;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(a)-'owner_id' order by created_at) from studio_core.posting_accounts a where owner_id=auth.uid()),'[]');
end $function$

-- studio_core.studio_posting_claim(p_id uuid, p_revision integer)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_claim(p_id uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts; token text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into c from studio_core.posting_copies where id=p_id and owner_id=auth.uid() for update;
 if c.id is null or c.revision<>p_revision or c.state<>'prepared' then raise exception 'Refresh the queue; this product is not ready'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Source changed or sold; refresh the queue' using errcode='40001'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id and owner_id=auth.uid() for update;
 if exists(select 1 from studio_core.posting_copies where account_id=c.account_id and owner_id=auth.uid() and id<>c.id and state in ('filling','filled'))
 then raise exception 'Finish the current destination draft before starting another'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 update studio_core.posting_copies set state='filling',transfer_hash=encode(extensions.digest(token,'sha256'),'hex'),
  transfer_expires=now()+interval '15 minutes',updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state) values(c.id,'filling');
 return jsonb_build_object('token',token,'id',c.id,'profile_id',a.profile_id,'account_label',a.label);
end $function$

-- studio_core.studio_posting_inventory(p_query text, p_offset integer, p_limit integer)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_inventory(p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 200 or length(p_query)>200 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('total',(select count(*) from public.active_listings a where a.is_active is true and a.status='active'
  and coalesce(a.quantity,1)>0 and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)),
 'items',coalesce(jsonb_agg(to_jsonb(r)),'[]')) into result from (
  select a.id,a.facebook_id,a.account_tag,a.title,a.description,a.price,a.condition,a.category,a.images,a.quantity,a.listing_url,
   studio_core.posting_digest(a) as digest,a.last_seen_at,
   (select coalesce(jsonb_agg(jsonb_build_object('account_id',c.account_id,'state',c.state,'id',c.id)),'[]')
    from studio_core.posting_copies c where c.source_id=a.id and c.owner_id=auth.uid()) as copies
  from public.active_listings a where a.is_active is true and a.status='active' and coalesce(a.quantity,1)>0
  and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)
  order by a.id desc limit p_limit offset p_offset
 ) r;
 return result;
end $function$

-- studio_core.studio_posting_prepare(p_account uuid, p_rows jsonb)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_prepare(p_account uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; src public.active_listings; dest studio_core.posting_accounts; prior studio_core.posting_copies;
 copy_id uuid; draft jsonb; photo text; manifest jsonb; entry jsonb; idx integer; results jsonb:='[]';
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into dest from studio_core.posting_accounts where id=p_account and owner_id=auth.uid();
 if dest.id is null then raise exception 'Choose your destination account'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 or octet_length(p_rows::text)>2000000
 then raise exception 'Choose between 1 and 50 products per batch'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by (value->>'source_id')::bigint loop
  select * into src from public.active_listings where id=(r->>'source_id')::bigint for share;
  if src.id is null or src.is_active is not true or src.status is distinct from 'active' or coalesce(src.quantity,1)<=0
  then raise exception 'A selected product is no longer available'; end if;
  if src.account_tag=dest.account_tag then raise exception 'Source and destination must differ'; end if;
  if studio_core.posting_digest(src) is distinct from r->>'digest' then raise exception 'Product changed; refresh before preparing' using errcode='40001'; end if;
  if nullif(trim(src.description),'') is null or nullif(trim(src.condition),'') is null or src.price is null or src.price<0
  then raise exception 'Source description, condition, or price is missing'; end if;
  draft:=r->'draft';
  if jsonb_typeof(draft) is distinct from 'object' or length(trim(coalesce(draft->>'title',''))) not between 1 and 150
   or length(trim(coalesce(draft->>'description',''))) not between 1 and 20000
   or jsonb_typeof(draft->'images') is distinct from 'array' or jsonb_array_length(draft->'images') not between 1 and 10
  then raise exception 'Check title, description, and one to ten photos'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(draft->'images'))<>jsonb_array_length(draft->'images') then raise exception 'Repeated photo'; end if;
  for photo in select value from jsonb_array_elements_text(draft->'images') loop
   if not (photo=any(coalesce(src.images,array[]::text[]))) or photo !~ '^https://sfheqjnxlkygjfohoybo\.supabase\.co/storage/v1/object/public/listing-images/'
   then raise exception 'Use an archived public photo from this product'; end if;
  end loop;
  manifest:='[]'::jsonb;
  if draft ? 'photo_style' then
   if draft->>'photo_style' is distinct from 'alt-frame-v1' or jsonb_typeof(draft->'photo_manifest') is distinct from 'array'
     or jsonb_array_length(draft->'photo_manifest') is distinct from jsonb_array_length(draft->'images')
   then raise exception 'Prepare every photo before saving this batch'; end if;
   for idx in 0..jsonb_array_length(draft->'images')-1 loop
    entry:=draft->'photo_manifest'->idx;
    if jsonb_typeof(entry) is distinct from 'object' or entry->>'url' is distinct from draft->'images'->>idx
      or coalesce(entry->>'source_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(entry->>'width','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'height','') !~ '^[0-9]{1,4}$'
    then raise exception 'Photo preparation is incomplete or in the wrong order'; end if;
    if (entry->>'width')::integer not between 1 and 1600 or (entry->>'height')::integer not between 1 and 1600
    then raise exception 'Prepared photo dimensions are invalid'; end if;
    manifest:=manifest||jsonb_build_array(jsonb_build_object('url',entry->>'url','source_sha256',entry->>'source_sha256','width',(entry->>'width')::integer,'height',(entry->>'height')::integer));
   end loop;
  end if;
  draft:=jsonb_build_object('title',trim(draft->>'title'),'description',trim(draft->>'description'),
   'price',src.price,'condition',src.condition,'category',src.category,'images',draft->'images') || case when draft ? 'photo_style' then jsonb_build_object('photo_style','alt-frame-v1','photo_manifest',manifest) else '{}'::jsonb end;
  select * into prior from studio_core.posting_copies where owner_id=auth.uid() and source_id=src.id and account_id=dest.id for update;
  if prior.id is not null and prior.state not in ('prepared','error','stale','cancelled') then
   raise exception 'This product already has a draft or listing on the destination';
  end if;
  insert into studio_core.posting_copies(owner_id,source_id,account_id,source_digest,draft)
  values(auth.uid(),src.id,dest.id,r->>'digest',draft)
  on conflict(owner_id,source_id,account_id) do update set draft=excluded.draft,source_digest=excluded.source_digest,
   state='prepared',revision=posting_copies.revision+1,issue=null,transfer_hash=null,transfer_expires=null,updated_at=now()
  where posting_copies.state in ('prepared','error','stale','cancelled')
  returning id into copy_id;
  if copy_id is null then raise exception 'Destination workflow changed; refresh before preparing' using errcode='40001'; end if;
  insert into studio_core.posting_events(copy_id,state) values(copy_id,'prepared');
  results:=results||jsonb_build_array(copy_id);
 end loop;
 return results;
end $function$

-- studio_core.studio_posting_queue()
CREATE OR REPLACE FUNCTION studio_core.studio_posting_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 -- Reconciliation is also performed on every attempted handoff. A stale snapshot never authorizes a fill.
 update studio_core.posting_copies c set state=case when c.state in ('filled','submitted','live') then 'remove_needed' else 'cancelled' end,
  issue='Source is no longer available',transfer_hash=null,updated_at=now()
 from public.active_listings s where c.source_id=s.id and c.owner_id=auth.uid()
  and (s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0)
  and c.state not in ('cancelled','remove_needed');
 update studio_core.posting_copies c set state='stale',issue='Source details changed; prepare this product again',transfer_hash=null,updated_at=now()
 from public.active_listings s where c.source_id=s.id and c.owner_id=auth.uid() and c.state in ('prepared','filling','error')
  and studio_core.posting_digest(s)<>c.source_digest;
 update studio_core.posting_copies set state='error',issue='Transfer expired. Inspect the Facebook draft before retrying.',transfer_hash=null,updated_at=now()
 where owner_id=auth.uid() and state='filling' and transfer_expires<now();
 -- Only a separately observed destination listing can be called live.
 update studio_core.posting_copies c set state='live',issue=null,updated_at=now()
 from studio_core.posting_accounts a, studio_core.facebook_observations o
 where c.owner_id=auth.uid() and c.state='submitted' and c.account_id=a.id and o.account_tag=a.account_tag
  and o.facebook_id=c.listing_id and o.observed_at>c.updated_at
  and o.evidence->>'status'='active' and o.evidence->>'title'=c.draft->>'title';
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
  select c.id,c.source_id,c.account_id,c.revision,c.state,c.draft,c.listing_id,c.issue,c.created_at,c.updated_at,
   a.label as account_label,a.profile_id,a.account_tag,s.title as original_title,s.listing_url as source_url,
   s.status as source_status,s.is_active as source_active
  from studio_core.posting_copies c join studio_core.posting_accounts a on a.id=c.account_id
  join public.active_listings s on s.id=c.source_id where c.owner_id=auth.uid()
 ) r),'[]');
end $function$

-- studio_core.studio_posting_result(p_id uuid, p_revision integer, p_action text, p_url text)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_result(p_id uuid, p_revision integer, p_action text, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c studio_core.posting_copies; listing text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into c from studio_core.posting_copies where id=p_id and owner_id=auth.uid() for update;
 if c.id is null or c.revision<>p_revision then raise exception 'Refresh the queue' using errcode='40001'; end if;
 if p_action='submitted' then
  if c.state not in ('filled','submitted') then raise exception 'Fill and review the draft first'; end if;
  listing:=substring(p_url from '^https://(?:www\.|m\.)?facebook\.com/marketplace/item/([0-9]{10,25})/?(?:\?.*)?$');
  if listing is null or listing=(select facebook_id from public.active_listings where id=c.source_id)
  then raise exception 'Paste the new destination listing URL'; end if;
  update studio_core.posting_copies set state='submitted',listing_id=listing,issue='Publication recorded; awaiting destination observation',transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='retry' then
  if c.state<>'error' then raise exception 'Only a failed transfer can be retried'; end if;
  update studio_core.posting_copies set state='prepared',revision=revision+1,issue=null,transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='cancel' then
  if c.state in ('submitted','live','remove_needed') then raise exception 'Mark the Facebook listing sold or remove it first'; end if;
  update studio_core.posting_copies set state='cancelled',transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='removed' then
  if c.state<>'remove_needed' then raise exception 'No removal is pending'; end if;
  update studio_core.posting_copies set state='cancelled',issue='Seller confirmed destination removal',updated_at=now() where id=c.id;
 else raise exception 'Unknown queue action'; end if;
 insert into studio_core.posting_events(copy_id,state,evidence) values(c.id,p_action,jsonb_build_object('listing_id',listing,'actor',auth.uid()));
 return jsonb_build_object('ok',true);
end $function$

-- studio_core.studio_posting_transfer(p_token text, p_action text, p_evidence jsonb)
CREATE OR REPLACE FUNCTION studio_core.studio_posting_transfer(p_token text, p_action text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts; entry jsonb; expected jsonb; idx integer;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>20000 then raise exception 'Invalid photo evidence'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transfer'; end if;
 select * into c from studio_core.posting_copies where transfer_hash=encode(extensions.digest(p_token,'sha256'),'hex') and transfer_expires>now() for update;
 if c.id is null or c.state<>'filling' or not exists(select 1 from studio_core.members where user_id=c.owner_id and enabled)
 then raise exception 'Transfer expired or already completed'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Product changed or sold'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id;
 if p_action='read' then return jsonb_build_object('id',c.id,'revision',c.revision,'source_id',c.source_id,'item',c.draft,'profile_id',a.profile_id,'account_label',a.label); end if;
 if p_action='filled' then
  if p_evidence->>'profile_id' is distinct from a.profile_id or (p_evidence->>'photo_count')::integer is distinct from jsonb_array_length(c.draft->'images')
  then raise exception 'Account or photo verification failed'; end if;
  if c.draft ? 'photo_style' then
   if p_evidence->>'photo_style' is distinct from c.draft->>'photo_style'
    or jsonb_typeof(p_evidence->'photo_manifest') is distinct from 'array'
    or jsonb_array_length(p_evidence->'photo_manifest') is distinct from jsonb_array_length(c.draft->'images')
   then raise exception 'Prepared photo verification failed; reload the updated extension'; end if;
   for idx in 0..jsonb_array_length(c.draft->'images')-1 loop
    entry:=p_evidence->'photo_manifest'->idx;expected:=c.draft->'photo_manifest'->idx;
    if (entry-'output_sha256') is distinct from expected or coalesce(entry->>'output_sha256','') !~ '^[a-f0-9]{64}$'
    then raise exception 'Uploaded photos do not match the prepared batch'; end if;
   end loop;
  end if;
 elsif p_action<>'error' then raise exception 'Invalid transfer action'; end if;
 update studio_core.posting_copies set state=p_action,issue=case when p_action='error' then left(p_evidence->>'error',500) else null end,
  transfer_hash=null,transfer_expires=null,updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state,evidence) values(c.id,p_action,p_evidence-'token');
 return jsonb_build_object('ok',true);
end $function$
