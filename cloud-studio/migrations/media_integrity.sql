-- Additive integrity projection. Does not select photos or modify seller fields.
create or replace function studio_core.media_health(p_item text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s studio_core.photo_selection; e studio_core.export_sets;
 selected_count integer; missing_selected integer; reference_count integer; missing_refs integer; prepared integer; preview text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into s from studio_core.photo_selection where inventory_id=p_item;
 select * into e from studio_core.export_sets where inventory_id=p_item;
 selected_count:=coalesce(jsonb_array_length(s.selection),0);
 select count(*) into missing_selected from jsonb_array_elements(coalesce(e.images,'[]'::jsonb)) x
 where not exists(select 1 from storage.objects o where o.bucket_id='studio-originals' and o.name='exports/'||(x->>'sha')
 and (o.metadata->>'size')::bigint=(x->>'bytes')::bigint);
 select count(*),count(*) filter(where not exists(select 1 from storage.objects o where o.bucket_id=r.bucket and o.name=r.object_path and (o.metadata->>'size')::bigint=r.bytes))
 into reference_count,missing_refs from studio_core.reference_assets r where inventory_id=p_item;
 select reference_id into preview from studio_core.reference_assets r where inventory_id=p_item and cloud_verified_at is not null
 and exists(select 1 from storage.objects o where o.bucket_id=r.bucket and o.name=r.object_path and (o.metadata->>'size')::bigint=r.bytes) order by reference_id limit 1;
 select count(*) into prepared from studio_core.photo_choices where inventory_id=p_item;
 return jsonb_build_object('selected',selected_count,'references',reference_count,'prepared',prepared,
 'missing_selected',missing_selected,'missing_references',missing_refs,'preview_reference',preview,
 'export_ready',coalesce(s.exports_verified and s.selection=e.selection and selected_count between 1 and 10
 and jsonb_array_length(e.images)=selected_count and missing_selected=0,false));
end $$;
revoke all on function studio_core.media_health(text) from public,anon,authenticated,service_role;

create or replace function studio_core.media_audit() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',a.fields->>'title','health',studio_core.media_health(i.id)) order by i.id),'[]')
 from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id where i.lifecycle<>'archived');
end $$;
revoke all on function studio_core.media_audit() from public,anon,authenticated,service_role;
create or replace function public.studio_media_audit() returns jsonb language sql security definer set search_path='' as $$ select studio_core.media_audit() $$;
revoke all on function public.studio_media_audit() from public,anon,service_role;
grant execute on function public.studio_media_audit() to authenticated;

create or replace function studio_core.assert_releasable_photo_identity(p_item text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if not exists(select 1 from studio_core.inventory where id=p_item and lifecycle='current') or
 not (studio_core.media_health(p_item)->>'export_ready')::boolean then
 raise exception 'Select one to ten prepared photos with valid stored JPEGs before approval' using errcode='23514';end if;
end $$;

CREATE OR REPLACE FUNCTION studio_core.read_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from studio_core.members where user_id=auth.uid() and enabled) then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'lifecycle',i.lifecycle,'fields',a.fields,'revision',a.revision,'status',a.status,
  'generated_candidate',g.fields,'identity',p.identity,'identity_status',p.verification_status,'identity_revision',p.revision,
  'research',r.research,'catalog_evidence',coalesce(ce.records,'[]'::jsonb),
  'visual_proposal',case when v.evidence is null then null
   when fresh.valid then v.evidence else v.evidence || jsonb_build_object(
    'suggestion','{}'::jsonb,'confidence','stale','observations',coalesce(v.evidence->'observations','[]'::jsonb) ||
     jsonb_build_array('Listing or source photos changed. Run identification again before using a suggestion.')) end,
  'proposal_revision',v.based_on_revision,'proposal_current',coalesce(fresh.valid,false),
  'photo_selection',s.selection,'exports_verified',s.exports_verified,
  'media_health',studio_core.media_health(i.id),
  'field_sources',(select coalesce(jsonb_object_agg(fp.field_name,fp.source),'{}'::jsonb) from studio_core.field_provenance fp where fp.inventory_id=i.id)
 ) order by i.id),'[]'::jsonb)
 from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
 left join studio_core.generated_copy g on g.inventory_id=i.id
 left join studio_core.product_identity p on p.inventory_id=i.id
 left join studio_core.research_evidence r on r.inventory_id=i.id
 left join lateral (select jsonb_agg(jsonb_build_object('id',e.id,'source_kind',e.source_kind,'url',e.url,
  'product_name',e.product_name,'brand',e.brand,'model',e.model,'evidence',e.evidence,
  'based_on_listing_revision',e.based_on_listing_revision,'based_on_identity_revision',e.based_on_identity_revision,
  'recorded_at',e.recorded_at) order by e.id desc) records from studio_core.catalog_evidence e where e.inventory_id=i.id) ce on true
 left join lateral (select evidence,based_on_revision from studio_core.field_proposals
  where inventory_id=i.id and source='cloud_visual_research' order by id desc limit 1) v on true
 left join studio_core.photo_selection s on s.inventory_id=i.id
 left join lateral (select coalesce(jsonb_agg(t.sha256 order by t.ord),'[]'::jsonb) hashes from (
  select asset.sha256,x.ord from jsonb_array_elements(s.selection) with ordinality x(photo,ord)
  join studio_core.photo_assets asset on asset.sha256=photo->>'sha' and asset.cloud_verified_at is not null
  where photo->>'kind'='real' and asset.bytes<=16000000 order by x.ord limit 2) t) photos on true
 left join lateral (select v.based_on_revision=a.revision and photos.hashes<>'[]'::jsonb
  and v.evidence->'photo_hashes'=photos.hashes as valid) fresh on true);
end $function$

;

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

;
revoke all on function public.studio_append_manual_photo(uuid,text,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_append_manual_photo(uuid,text,bigint,jsonb,text) to service_role;
