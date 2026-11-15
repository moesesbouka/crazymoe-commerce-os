-- Crazy Moe Marketplace correctness and release-control hardening.
-- Drafted from the live 2026-11-15 schema capture.
-- Drafts remain saveable; automation transitions fail closed.

create table if not exists studio_core.mercari_condition_map(
  source_value text primary key,
  target_value text not null check(target_value in ('New','Like new','Good','Fair','Poor')),
  created_at timestamptz not null default now()
);
revoke all on studio_core.mercari_condition_map from public, anon, authenticated;
insert into studio_core.mercari_condition_map(source_value,target_value) values
 ('new','New'),('new with tags','New'),('new without tags','Like new'),
 ('used - like new','Like new'),('like new','Like new'),
 ('used','Good'),('used - good','Good'),('good','Good'),
 ('used - fair','Fair'),('fair','Fair'),('poor','Poor'),
 ('for parts or not working','Poor')
on conflict(source_value) do update set target_value=excluded.target_value;

create table if not exists studio_core.mercari_availability_overrides(
  owner_id uuid not null references auth.users(id),
  source_kind text not null check(source_kind in ('studio','imported')),
  source_id text not null,
  confirmed_at timestamptz not null default now(),
  reason text not null check(length(reason) between 1 and 500),
  primary key(owner_id,source_kind,source_id)
);
revoke all on studio_core.mercari_availability_overrides from public, anon, authenticated;

create table if not exists studio_core.physical_links(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  studio_id text not null references studio_core.inventory(id),
  imported_id bigint not null references public.active_listings(id),
  status text not null check(status in ('candidate','confirmed','rejected')),
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  unique(owner_id,studio_id,imported_id)
);
create unique index if not exists physical_links_confirmed_studio
 on studio_core.physical_links(owner_id,studio_id) where status='confirmed';
create unique index if not exists physical_links_confirmed_imported
 on studio_core.physical_links(owner_id,imported_id) where status='confirmed';
revoke all on studio_core.physical_links from public, anon, authenticated;

alter table studio_core.mercari_queue
  add column if not exists physical_link_id uuid references studio_core.physical_links(id),
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists handoff_lease uuid,
  add column if not exists handoff_revision integer,
  add column if not exists handoff_expires_at timestamptz,
  add column if not exists correlation_id uuid;
create unique index if not exists mercari_queue_one_confirmed_physical_item
 on studio_core.mercari_queue(owner_id,physical_link_id)
 where physical_link_id is not null and state not in ('sold','cancelled','skipped');

alter table studio_core.mercari_queue drop constraint if exists mercari_queue_state_check;
alter table studio_core.mercari_queue add constraint mercari_queue_state_check
 check(state in ('needs_details','ready','handed_off','posted','sold','cancelled','source_unavailable','skipped'));

create table if not exists studio_core.release_manifest(
  id uuid primary key default gen_random_uuid(),
  release_name text not null unique,
  git_sha text not null,
  vercel_deployment_id text not null,
  migration_head text not null,
  companion_version text not null,
  companion_sha256 text not null check(companion_sha256 ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  manifest jsonb not null default '{}'::jsonb check(jsonb_typeof(manifest)='object'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists release_manifest_one_active on studio_core.release_manifest(active) where active;
revoke all on studio_core.release_manifest from public, anon, authenticated;

create table if not exists studio_core.client_events(
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  correlation_id uuid not null,
  surface text not null check(length(surface) between 1 and 50),
  action text not null check(length(action) between 1 and 80),
  result_code text not null check(result_code ~ '^[A-Z0-9_]{1,80}$'),
  issue_codes jsonb not null default '[]'::jsonb check(jsonb_typeof(issue_codes)='array'),
  queue_id uuid references studio_core.mercari_queue(id),
  revision integer,
  companion_version text,
  studio_build text,
  duration_ms integer check(duration_ms is null or duration_ms between 0 and 3600000),
  created_at timestamptz not null default now()
);
create index if not exists client_events_owner_created on studio_core.client_events(owner_id,created_at desc);
revoke all on studio_core.client_events from public, anon, authenticated;

create table if not exists studio_core.channel_publication_evidence(
  id bigint generated always as identity primary key,
  inventory_id text not null references studio_core.inventory(id),
  channel text not null check(channel in ('facebook','mercari')),
  evidence_level text not null check(evidence_level in ('seller_asserted','form_filled','url_captured','url_reverified','sold','removed')),
  listing_url text,
  listing_revision bigint,
  actor uuid references auth.users(id),
  payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now()
);
create index if not exists publication_evidence_item_channel on studio_core.channel_publication_evidence(inventory_id,channel,created_at desc);
revoke all on studio_core.channel_publication_evidence from public, anon, authenticated;

create or replace function studio_core.mercari_condition(p_value text)
returns jsonb language sql stable set search_path='' as $$
 select case
  when trim(coalesce(p_value,''))='' then jsonb_build_object('value','New','provenance','defaulted','raw','')
  when m.target_value is not null then jsonb_build_object('value',m.target_value,'provenance','source_mapped','raw',p_value)
  else jsonb_build_object('value','','provenance','unmapped','raw',p_value)
 end
 from (select 1) x
 left join studio_core.mercari_condition_map m on m.source_value=lower(trim(coalesce(p_value,'')));
$$;

create or replace function studio_core.mercari_readiness(p_draft jsonb,p_source jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  issues jsonb:='[]'::jsonb;
  shipping jsonb:=coalesce(p_draft->'shipping','{}'::jsonb);
  key text;
  raw_condition text:=coalesce(p_source#>>'{fields,condition}','');
  blocking integer;
begin
  if p_source is null or not coalesce((p_source->>'available')::boolean,false) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','SOURCE_UNAVAILABLE','field','source','severity','block','message','Product is no longer available in inventory'));
  elsif not coalesce((p_source->>'eligible')::boolean,true) then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','SOURCE_STALE','field','source','severity','block','message','Inventory has not been confirmed within seven days'));
  end if;
  if trim(coalesce(p_draft->>'title',''))='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','TITLE_REQUIRED','field','title','severity','block','message','Add a title'));
  elsif length(p_draft->>'title')>80 then issues:=issues||jsonb_build_array(jsonb_build_object('code','TITLE_TOO_LONG','field','title','severity','block','message','Shorten the title to 80 characters')); end if;
  if trim(coalesce(p_draft->>'description',''))='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','DESCRIPTION_REQUIRED','field','description','severity','block','message','Add a description'));
  elsif length(p_draft->>'description')>1000 then issues:=issues||jsonb_build_array(jsonb_build_object('code','DESCRIPTION_TOO_LONG','field','description','severity','block','message','Shorten the description to 1,000 characters')); end if;
  if coalesce(p_draft->>'price','') !~ '^[0-9]{1,4}([.][0-9]{1,2})?$' or
     (case when coalesce(p_draft->>'price','') ~ '^[0-9]{1,4}([.][0-9]{1,2})?$' then (p_draft->>'price')::numeric else 0 end) not between 1 and 2000 then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','PRICE_RANGE','field','price','severity','block','message','Set a price from $1 to $2,000'));
  end if;
  if coalesce(p_draft->>'condition','') not in ('New','Like new','Good','Fair','Poor') then
    issues:=issues||jsonb_build_array(jsonb_build_object(
      'code',case when trim(raw_condition)<>'' then 'CONDITION_UNMAPPED' else 'CONDITION_REQUIRED' end,
      'field','condition','severity','block',
      'message',case when trim(raw_condition)<>'' then 'Choose a Mercari condition for source value: '||raw_condition else 'Choose a Mercari condition' end,
      'raw',raw_condition));
  elsif trim(raw_condition)='' and p_draft->>'condition'='New' then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','CONDITION_DEFAULTED','field','condition','severity','warn','message','Condition is assumed New because the source was blank'));
  end if;
  if trim(coalesce(p_draft->>'category',''))='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','CATEGORY_REQUIRED','field','category','severity','block','message','Choose the Mercari category')); end if;
  if trim(coalesce(p_draft->>'brand',''))='' then issues:=issues||jsonb_build_array(jsonb_build_object('code','BRAND_REQUIRED','field','brand','severity','block','message','Enter the brand, or No brand')); end if;
  if jsonb_typeof(p_draft->'photos') is distinct from 'array' or jsonb_array_length(coalesce(p_draft->'photos','[]'::jsonb)) not between 1 and 12 then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','PHOTOS_REQUIRED','field','photos','severity','block','message','Select 1 to 12 product photos'));
  elsif coalesce(p_draft->'photos'->0->>'kind','') in ('manufacturer','barcode','label') then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','PHOTO_COVER_FORBIDDEN','field','photos','severity','block','message','Use an actual-item photo as the cover'));
  end if;
  if coalesce(shipping->>'payer','') not in ('buyer','seller') then issues:=issues||jsonb_build_array(jsonb_build_object('code','SHIPPING_PAYER_REQUIRED','field','shipping.payer','severity','block','message','Choose who pays shipping')); end if;
  foreach key in array array['weight_oz','length_in','width_in','height_in'] loop
    if coalesce(shipping->>key,'') !~ '^[0-9]{1,5}([.][0-9]{1,2})?$' or
       (case when coalesce(shipping->>key,'') ~ '^[0-9]{1,5}([.][0-9]{1,2})?$' then (shipping->>key)::numeric else 0 end)<=0 then
      issues:=issues||jsonb_build_array(jsonb_build_object(
        'code',case when key='weight_oz' then 'WEIGHT_REQUIRED' else 'DIMENSIONS_REQUIRED' end,
        'field','shipping.'||key,'severity','block','message','Enter positive packed '||replace(key,'_',' ')));
    end if;
  end loop;
  if p_source->>'source_kind'='studio' and coalesce(p_source->>'identity_status','unverified')<>'verified_exact' then
    issues:=issues||jsonb_build_array(jsonb_build_object('code','IDENTITY_NOT_EXACT','field','identity','severity','warn','message','Product identity is not independently verified'));
  end if;
  select count(*) into blocking from jsonb_array_elements(issues) i where i->>'severity'='block';
  return jsonb_build_object('ready',blocking=0,'policy_version','mercari-2026-11-15.1','issues',issues,'blocking_count',blocking);
end $$;

create or replace function studio_core.mercari_issues(p_draft jsonb,p_source jsonb)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(i->'message'),'[]'::jsonb)
 from jsonb_array_elements(studio_core.mercari_readiness(p_draft,p_source)->'issues') i
 where i->>'severity'='block';
$$;

create or replace function studio_core.mercari_validate(p_draft jsonb,p_source jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare photo jsonb; key text;
begin
 if jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>30000
 or jsonb_typeof(p_draft->'photos') is distinct from 'array' or jsonb_array_length(p_draft->'photos')>12
 or jsonb_typeof(p_draft->'shipping') is distinct from 'object' then raise exception 'Invalid prepared listing'; end if;
 for key in select jsonb_object_keys(p_draft) loop
  if key not in ('title','description','price','condition','category','brand','shipping','photos','photos_confirmed') then raise exception 'Unknown listing field'; end if;
 end loop;
 foreach key in array array['title','description','price','condition','category','brand'] loop
  if jsonb_typeof(p_draft->key) is distinct from 'string' then raise exception 'Invalid listing field: %',key; end if;
 end loop;
 if length(p_draft->>'title')>200 or length(p_draft->>'description')>20000 or length(p_draft->>'brand')>200 or length(p_draft->>'category')>500
 or length(p_draft->>'price')>20 then raise exception 'Listing field too long'; end if;
 if p_draft ? 'photos_confirmed' and jsonb_typeof(p_draft->'photos_confirmed') is distinct from 'boolean' then raise exception 'Invalid legacy photo flag'; end if;
 if (select count(distinct value) from jsonb_array_elements(p_draft->'photos'))<>jsonb_array_length(p_draft->'photos') then raise exception 'Duplicate photo'; end if;
 for photo in select value from jsonb_array_elements(p_draft->'photos') loop
  if not coalesce((p_source->'photos') @> jsonb_build_array(photo),false) then raise exception 'Photo does not belong to this source'; end if;
 end loop;
 if jsonb_typeof(p_draft->'shipping'->'payer') is distinct from 'string' then raise exception 'Invalid shipping'; end if;
 for key in select jsonb_object_keys(p_draft->'shipping') loop
  if key not in ('payer','weight_oz','length_in','width_in','height_in') or jsonb_typeof(p_draft->'shipping'->key) is distinct from 'string'
  or length(p_draft->'shipping'->>key)>20 then raise exception 'Invalid shipping field'; end if;
 end loop;
end $$;

create or replace function studio_core.mercari_source(p_kind text,p_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; actor uuid:=auth.uid(); override_at timestamptz; link jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select jsonb_build_object('id',l.id,'status',l.status,'studio_id',l.studio_id,'imported_id',l.imported_id)
 into link from studio_core.physical_links l
 where l.owner_id=actor and ((p_kind='studio' and l.studio_id=p_id) or (p_kind='imported' and l.imported_id::text=p_id))
 order by case l.status when 'confirmed' then 0 when 'candidate' then 1 else 2 end,l.created_at limit 1;
 if p_kind='studio' then
  select jsonb_build_object('source_kind','studio','source_id',i.id,'revision',a.revision,
   'available',i.lifecycle='current' and a.status<>'archived','fresh',true,'eligible',i.lifecycle='current' and a.status<>'archived',
   'freshness','studio_current','identity_status',p.verification_status,'physical_link',link,
   'fields',a.fields,'suggestions',g.fields,'brand',coalesce(a.fields->>'brand',p.identity->>'brand',''),
   'photos',coalesce((select jsonb_agg(v.photo order by v.pos) from (
    select distinct on (x.photo->>'sha') x.pos,jsonb_build_object('sha',f.sha256,'bytes',f.bytes,'name',coalesce(x.photo->>'name','photo.jpg'),'kind','original') photo
    from jsonb_array_elements(coalesce(s.selection,'[]')) with ordinality x(photo,pos)
    join studio_core.photo_assets f on f.sha256=x.photo->>'sha' and f.cloud_verified_at is not null
    where x.photo->>'kind'='real' and f.bytes<=16000000 order by x.photo->>'sha',x.pos
   ) v),'[]'::jsonb)) into result
  from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
  left join studio_core.product_identity p on p.inventory_id=i.id left join studio_core.generated_copy g on g.inventory_id=i.id
  left join studio_core.photo_selection s on s.inventory_id=i.id where i.id=p_id;
 elsif p_kind='imported' then
  select confirmed_at into override_at from studio_core.mercari_availability_overrides
   where owner_id=actor and source_kind='imported' and source_id=p_id;
  select jsonb_build_object('source_kind','imported','source_id',a.id::text,
   'available',a.is_active and a.status='active' and coalesce(a.quantity,1)>0,
   'fresh',coalesce(a.last_seen_at,'epoch')>=now()-interval '7 days',
   'eligible',a.is_active and a.status='active' and coalesce(a.quantity,1)>0 and
     (coalesce(a.last_seen_at,'epoch')>=now()-interval '7 days' or coalesce(override_at,'epoch')>=now()-interval '7 days'),
   'freshness',case when coalesce(a.last_seen_at,'epoch')>=now()-interval '7 days' then 'observed'
                    when coalesce(override_at,'epoch')>=now()-interval '7 days' then 'seller_confirmed' else 'stale' end,
   'last_seen_at',a.last_seen_at,'availability_confirmed_at',override_at,'physical_link',link,
   'fields',jsonb_build_object('title',a.title,'description',coalesce(nullif(a.description,''),nullif(m.description,''),nullif(rec.description,'')),
     'price',a.price,'condition',coalesce(nullif(a.condition,''),nullif(m.condition,''),nullif(rec.condition,'')),'category',coalesce(nullif(a.category,''),m.category)),
   'brand',coalesce(a.metadata->>'brand',''),'facebook_id',a.facebook_id,'quantity',a.quantity,
   'photos',coalesce((select jsonb_agg(jsonb_build_object('url',v.url,'kind','imported') order by v.pos) from (
    select distinct on (x.url) x.url,x.pos from jsonb_array_elements_text(coalesce(to_jsonb(a.images),'[]')||coalesce(m.images,'[]')) with ordinality x(url,pos)
    where starts_with(x.url,'https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/')
    order by x.url,x.pos) v),'[]'::jsonb)||coalesce(rec.photos,'[]'::jsonb)) into result
  from public.active_listings a left join studio_core.mercari_import_recovery rec on rec.source_id=a.id
  left join lateral (select b.description,b.condition,b.category,b.images from public.marketplace_listings b
    where b.facebook_id=a.facebook_id and b.account_tag=a.account_tag order by b.updated_at desc nulls last limit 1) m on true
  where a.id::text=p_id;
 else raise exception 'Unknown inventory source'; end if;
 if result is null then return null; end if;
 return result||jsonb_build_object('digest',md5(result::text));
end $$;

create or replace function studio_core.mercari_inventory(p_kind text,p_query text default '',p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 200 or length(p_query)>200 or p_kind not in ('all','studio','imported') then raise exception 'Invalid inventory page'; end if;
 with ids as (
  select 'studio'::text source_kind,i.id from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
  where p_kind in ('all','studio') and i.lifecycle='current' and a.status<>'archived' and (p_kind<>'all' or a.status='listed')
   and (p_query='' or position(lower(p_query) in lower(a.fields::text||i.id))>0)
  union all
  select 'imported'::text,a.id::text from public.active_listings a
  where p_kind in ('all','imported') and a.is_active and a.status='active' and coalesce(a.quantity,1)>0
   and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)
   and (p_kind<>'all' or not exists(select 1 from studio_core.physical_links l where l.owner_id=auth.uid() and l.imported_id=a.id and l.status='confirmed'))
 ), page as (select source_kind,id from ids order by source_kind,id limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from ids),
  'items',coalesce((select jsonb_agg(studio_core.mercari_source(source_kind,id) order by source_kind,id) from page),'[]'::jsonb)) into result;
 return result;
end $$;

create or replace function studio_core.mercari_prepare(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb;src jsonb;q studio_core.mercari_queue;result jsonb:='[]';readiness jsonb;link_id uuid;created boolean;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Select 1 to 50 products'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  src:=studio_core.mercari_source(row->>'source_kind',row->>'source_id');
  if src is null or not coalesce((src->>'available')::boolean,false) then raise exception 'Product no longer available'; end if;
  if src->>'digest' is distinct from row->>'digest' then raise exception 'Inventory changed. Refresh before preparing.' using errcode='40001'; end if;
  perform studio_core.mercari_validate(row->'draft',src);
  readiness:=studio_core.mercari_readiness(row->'draft',src);
  link_id:=nullif(src#>>'{physical_link,id}','')::uuid;
  if coalesce(src#>>'{physical_link,status}','')<>'confirmed' then link_id:=null; end if;
  q:=null;created:=false;
  select * into q from studio_core.mercari_queue
   where owner_id=auth.uid() and source_kind=row->>'source_kind' and source_id=row->>'source_id' limit 1;
  if q.id is null and link_id is not null then
   select * into q from studio_core.mercari_queue
    where owner_id=auth.uid() and physical_link_id=link_id and state not in ('sold','cancelled','skipped') limit 1;
  end if;
  if q.id is null then
   insert into studio_core.mercari_queue(owner_id,source_kind,source_id,source_digest,source_snapshot,draft,state,physical_link_id,field_provenance)
   values(auth.uid(),row->>'source_kind',row->>'source_id',src->>'digest',src,row->'draft',
     case when (readiness->>'ready')::boolean then 'ready' else 'needs_details' end,link_id,
     jsonb_build_object('title','generated','description','generated','price','generated','condition',
       case when coalesce(src#>>'{fields,condition}','')='' then 'defaulted' else 'source_mapped' end,
       'category','generated','brand','generated','shipping','generated','photos','source'))
   on conflict(owner_id,source_kind,source_id) do update set source_snapshot=excluded.source_snapshot,source_digest=excluded.source_digest,
     physical_link_id=coalesce(mercari_queue.physical_link_id,excluded.physical_link_id),updated_at=now()
   returning * into q;
   created:=true;
  else
   update studio_core.mercari_queue set source_snapshot=src,source_digest=src->>'digest',
    physical_link_id=coalesce(physical_link_id,link_id),updated_at=now() where id=q.id returning * into q;
  end if;
  if created then insert into studio_core.mercari_events(queue_id,actor,event,revision,payload)
    values(q.id,auth.uid(),'prepared',q.revision,jsonb_build_object('policy_version',readiness->>'policy_version')); end if;
  result:=result||jsonb_build_object('id',q.id,'created',created);
 end loop;
 return result;
end $$;

create or replace function studio_core.mercari_update(p_id uuid,p_revision integer,p_action text,p_draft jsonb default null,p_url text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q studio_core.mercari_queue;src jsonb;ready jsonb;url text;key text;merged jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into q from studio_core.mercari_queue where id=p_id and owner_id=auth.uid() for update;
 if q.id is null then raise exception 'Queue item unavailable' using errcode='42501'; end if;
 if q.revision is distinct from p_revision then raise exception 'This queue item changed on another device. Refresh before saving.' using errcode='40001'; end if;
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 if p_action in ('save','rebuild','posted','download') then
  if src is null or not coalesce((src->>'available')::boolean,false) then
   raise exception 'Product is no longer available in inventory';
  end if;
  if p_action<>'rebuild' and src->>'digest' is distinct from q.source_digest then raise exception 'Source changed. Refresh this item from inventory first.' using errcode='40001'; end if;
 end if;
 if p_action in ('save','rebuild') then
  if q.state not in ('needs_details','ready','source_unavailable','cancelled') then raise exception 'Posted or handed-off items cannot be rebuilt'; end if;
  if p_action='save' and q.state in ('cancelled','source_unavailable') then raise exception 'Rebuild this item first'; end if;
  perform studio_core.mercari_validate(p_draft,src);
  merged:=p_draft;
  if p_action='save' then
   foreach key in array array['title','description','price','condition','category','brand','shipping','photos'] loop
    if q.draft->key is distinct from p_draft->key then q.field_provenance:=jsonb_set(q.field_provenance,array[key],to_jsonb('seller_set'::text),true); end if;
   end loop;
  else
   foreach key in array array['title','description','price','condition','category','brand','shipping'] loop
    if q.field_provenance->>key='seller_set' then merged:=jsonb_set(merged,array[key],q.draft->key,true); end if;
   end loop;
  end if;
  ready:=studio_core.mercari_readiness(merged,src);
  q.draft:=merged;q.state:=case when (ready->>'ready')::boolean then 'ready' else 'needs_details' end;
  q.source_snapshot:=src;q.source_digest:=src->>'digest';
 elsif p_action='posted' then
  ready:=studio_core.mercari_readiness(q.draft,src);
  if not (ready->>'ready')::boolean then raise exception 'Listing is not ready: %',ready->'issues'; end if;
  if q.state not in ('ready','handed_off') then raise exception 'Only a ready handoff can be marked posted'; end if;
  if coalesce(p_url,'') !~ '^https://(www[.])?mercari[.]com/us/item/m[0-9]+/?([?#].*)?$' then raise exception 'Paste the published Mercari item link'; end if;
  url:='https://www.mercari.com/us/item/'||substring(p_url from '/us/item/(m[0-9]+)')||'/';
  q.listing_url:=url;q.state:='posted';q.handoff_lease:=null;q.handoff_revision:=null;q.handoff_expires_at:=null;
 elsif p_action='sold' then
  if q.state not in ('ready','handed_off','posted','needs_details') then raise exception 'This item is already closed'; end if;q.state:='sold';
 elsif p_action='cancel' then
  if q.state not in ('needs_details','ready','source_unavailable') then raise exception 'Only an unposted queue item can be cancelled'; end if;q.state:='cancelled';
 elsif p_action='download' then
  ready:=studio_core.mercari_readiness(q.draft,src);
  if not (ready->>'ready')::boolean then raise exception 'Listing is not ready: %',ready->'issues'; end if;
  if q.state not in ('ready','handed_off','posted') then raise exception 'This queue item is not ready'; end if;
  return to_jsonb(q)||jsonb_build_object('readiness',ready);
 else raise exception 'Unknown queue action'; end if;
 update studio_core.mercari_queue set draft=q.draft,state=q.state,source_snapshot=q.source_snapshot,source_digest=q.source_digest,
  listing_url=q.listing_url,field_provenance=q.field_provenance,handoff_lease=q.handoff_lease,handoff_revision=q.handoff_revision,
  handoff_expires_at=q.handoff_expires_at,revision=revision+1,updated_at=now() where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,auth.uid(),p_action,q.revision,
  jsonb_build_object('state',q.state,'listing_url',q.listing_url,'policy_version',coalesce(ready->>'policy_version','')));
 return to_jsonb(q)||case when ready is null then '{}'::jsonb else jsonb_build_object('readiness',ready) end;
end $$;

create or replace function studio_core.mercari_handoff(p_id uuid,p_revision integer,p_event text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q studio_core.mercari_queue;src jsonb;link text;ready jsonb;request_id uuid;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if coalesce(p_event,'') not in ('filled','needs_attention','error','published') or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>10000 then raise exception 'Invalid fill result';end if;
 select * into strict q from studio_core.mercari_queue where id=p_id and owner_id=auth.uid() for update;
 if q.revision is distinct from p_revision then raise exception 'Listing changed while the Mercari form was open' using errcode='40001';end if;
 if q.state not in ('ready','handed_off') then raise exception 'This listing is not ready for a browser handoff';end if;
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 if p_event<>'error' and (src is null or not coalesce((src->>'available')::boolean,false) or src->>'digest' is distinct from q.source_digest)
 then raise exception 'Inventory changed during the Mercari handoff' using errcode='40001';end if;
 if p_event in ('filled','published') then
  ready:=studio_core.mercari_readiness(q.draft,src);
  if not (ready->>'ready')::boolean then raise exception 'Listing is not ready: %',ready->'issues'; end if;
 end if;
 if coalesce(p_details->>'requestId','') ~ '^[a-f0-9-]{36}$' then request_id:=(p_details->>'requestId')::uuid; end if;
 if p_event='filled' then
  q.state:='handed_off';q.handoff_lease:=coalesce(request_id,gen_random_uuid());q.handoff_revision:=q.revision+1;
  q.handoff_expires_at:=now()+interval '15 minutes';q.revision:=q.revision+1;
 elsif p_event in ('needs_attention','error') then
  if q.state='handed_off' then q.state:='ready';q.revision:=q.revision+1; end if;
  q.handoff_lease:=null;q.handoff_revision:=null;q.handoff_expires_at:=null;
 elsif p_event='published' then
  if q.state<>'handed_off' or q.handoff_revision is distinct from q.revision or q.handoff_expires_at<=now()
  then raise exception 'The browser handoff lease expired. Fill the form again.';end if;
  if request_id is null or request_id is distinct from q.handoff_lease then raise exception 'Browser handoff does not match this listing revision';end if;
  if coalesce(p_details->>'url','') !~ '^https://www[.]mercari[.]com/us/item/m[0-9]+/?$' then raise exception 'Invalid Mercari listing link';end if;
  link:='https://www.mercari.com/us/item/'||substring(p_details->>'url' from '/us/item/(m[0-9]+)')||'/';
  q.state:='posted';q.listing_url:=link;q.revision:=q.revision+1;q.handoff_lease:=null;q.handoff_revision:=null;q.handoff_expires_at:=null;
 end if;
 update studio_core.mercari_queue set state=q.state,listing_url=q.listing_url,revision=q.revision,handoff_lease=q.handoff_lease,
  handoff_revision=q.handoff_revision,handoff_expires_at=q.handoff_expires_at,
  handoff=jsonb_build_object('state',p_event,'details',p_details,'recorded_at',now()),updated_at=now() where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,auth.uid(),'browser_'||p_event,q.revision,p_details);
 return to_jsonb(q)||case when ready is null then '{}'::jsonb else jsonb_build_object('readiness',ready) end;
end $$;

create or replace function studio_core.mercari_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 return jsonb_build_object('queue',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object(
  'stale',s.data->>'digest' is distinct from q.source_digest,'available',coalesce((s.data->>'available')::boolean,false),
  'eligible',coalesce((s.data->>'eligible')::boolean,true),'readiness',studio_core.mercari_readiness(q.draft,s.data),
  'issues',studio_core.mercari_issues(q.draft,s.data)) order by q.created_at,q.id)
  from studio_core.mercari_queue q left join lateral(select studio_core.mercari_source(q.source_kind,q.source_id) data) s on true
  where q.owner_id=auth.uid()),'[]'::jsonb),
 'presets',coalesce((select jsonb_agg(to_jsonb(p)-'owner_id' order by p.name) from studio_core.mercari_presets p where p.owner_id=auth.uid()),'[]'::jsonb),
 'release',(select to_jsonb(r)-'manifest' from studio_core.release_manifest r where active order by created_at desc limit 1));
end $$;

create or replace function studio_core.mercari_confirm_available(p_kind text,p_id text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src jsonb;q studio_core.mercari_queue;ready jsonb;
begin
 if not studio_core.is_member() or auth.uid() is null then raise exception 'Studio access denied' using errcode='42501';end if;
 if p_kind not in ('studio','imported') or length(p_id)>100 or length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'Invalid availability confirmation';end if;
 src:=studio_core.mercari_source(p_kind,p_id);
 if src is null or not coalesce((src->>'available')::boolean,false) then raise exception 'Product is not active in inventory';end if;
 insert into studio_core.mercari_availability_overrides(owner_id,source_kind,source_id,confirmed_at,reason)
 values(auth.uid(),p_kind,p_id,now(),trim(p_reason))
 on conflict(owner_id,source_kind,source_id) do update set confirmed_at=excluded.confirmed_at,reason=excluded.reason;
 src:=studio_core.mercari_source(p_kind,p_id);
 for q in select * from studio_core.mercari_queue where owner_id=auth.uid() and source_kind=p_kind and source_id=p_id and state in ('source_unavailable','needs_details','ready') for update loop
  ready:=studio_core.mercari_readiness(q.draft,src);
  update studio_core.mercari_queue set state=case when (ready->>'ready')::boolean then 'ready' else 'needs_details' end,
   source_snapshot=src,source_digest=src->>'digest',revision=revision+1,updated_at=now() where id=q.id;
 end loop;
 return src;
end $$;

create or replace function studio_core.mercari_links(p_action text default 'state',p_link uuid default null,p_studio text default null,p_imported bigint default null,p_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();link studio_core.physical_links;
begin
 if actor is null or not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if p_action='candidate' then
  if p_studio is null or p_imported is null or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>10000 then raise exception 'Invalid identity candidate';end if;
  if studio_core.mercari_source('studio',p_studio) is null or studio_core.mercari_source('imported',p_imported::text) is null then raise exception 'Identity source missing';end if;
  insert into studio_core.physical_links(owner_id,studio_id,imported_id,status,evidence) values(actor,p_studio,p_imported,'candidate',p_evidence)
  on conflict(owner_id,studio_id,imported_id) do update set evidence=excluded.evidence where physical_links.status='candidate';
 elsif p_action in ('confirm','reject') then
  select * into strict link from studio_core.physical_links where id=p_link and owner_id=actor for update;
  update studio_core.physical_links set status=case p_action when 'confirm' then 'confirmed' else 'rejected' end,
   reviewed_at=now(),reviewed_by=actor where id=link.id;
 elsif p_action<>'state' then raise exception 'Unknown identity action';end if;
 return jsonb_build_object('links',coalesce((select jsonb_agg(to_jsonb(l)-'owner_id' order by l.created_at desc) from studio_core.physical_links l where l.owner_id=actor),'[]'::jsonb));
end $$;

create or replace function studio_core.record_client_event(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>5000 then raise exception 'Invalid client event';end if;
 insert into studio_core.client_events(owner_id,correlation_id,surface,action,result_code,issue_codes,queue_id,revision,companion_version,studio_build,duration_ms)
 values(auth.uid(),(p_event->>'correlation_id')::uuid,left(p_event->>'surface',50),left(p_event->>'action',80),left(p_event->>'result_code',80),
  coalesce(p_event->'issue_codes','[]'),nullif(p_event->>'queue_id','')::uuid,nullif(p_event->>'revision','')::integer,
  left(p_event->>'companion_version',40),left(p_event->>'studio_build',80),nullif(p_event->>'duration_ms','')::integer);
end $$;

create or replace function public.studio_mercari_readiness(p_id uuid)
returns jsonb language sql set search_path='' as $$
 select studio_core.mercari_readiness(q.draft,studio_core.mercari_source(q.source_kind,q.source_id))||
  jsonb_build_object('queue_id',q.id,'revision',q.revision)
 from studio_core.mercari_queue q where q.id=p_id and q.owner_id=auth.uid();
$$;
create or replace function public.studio_mercari_confirm_available(p_kind text,p_id text,p_reason text)
returns jsonb language sql set search_path='' as $$select studio_core.mercari_confirm_available(p_kind,p_id,p_reason)$$;
create or replace function public.studio_mercari_links(p_action text default 'state',p_link uuid default null,p_studio text default null,p_imported bigint default null,p_evidence jsonb default '{}'::jsonb)
returns jsonb language sql set search_path='' as $$select studio_core.mercari_links(p_action,p_link,p_studio,p_imported,p_evidence)$$;
create or replace function public.studio_record_client_event(p_event jsonb)
returns void language sql set search_path='' as $$select studio_core.record_client_event(p_event)$$;

revoke all on function public.studio_mercari_readiness(uuid) from public,anon;
revoke all on function public.studio_mercari_confirm_available(text,text,text) from public,anon;
revoke all on function public.studio_mercari_links(text,uuid,text,bigint,jsonb) from public,anon;
revoke all on function public.studio_record_client_event(jsonb) from public,anon;
grant execute on function public.studio_mercari_readiness(uuid) to authenticated;
grant execute on function public.studio_mercari_confirm_available(text,text,text) to authenticated;
grant execute on function public.studio_mercari_links(text,uuid,text,bigint,jsonb) to authenticated;
grant execute on function public.studio_record_client_event(jsonb) to authenticated;

-- Seed review candidates only. Nothing is automatically merged.
insert into studio_core.physical_links(owner_id,studio_id,imported_id,status,evidence)
select m.user_id,s.inventory_id,a.id,'candidate',
 jsonb_build_object('signal','exact_normalized_title','studio_title',s.fields->>'title','imported_title',a.title)
from studio_core.members m
join studio_core.listing_authoring s on s.status<>'archived'
join public.active_listings a on a.is_active and a.status='active' and
 lower(regexp_replace(coalesce(s.fields->>'title',''),'[^a-zA-Z0-9]','','g'))=
 lower(regexp_replace(coalesce(a.title,''),'[^a-zA-Z0-9]','','g'))
where m.enabled and length(regexp_replace(coalesce(a.title,''),'[^a-zA-Z0-9]','','g'))>=8
on conflict(owner_id,studio_id,imported_id) do nothing;

insert into studio_core.channel_publication_evidence(inventory_id,channel,evidence_level,listing_revision,actor,payload)
select a.inventory_id,'facebook','seller_asserted',a.revision,
 (select user_id from studio_core.members where enabled and role='owner' order by user_id limit 1),
 jsonb_build_object('legacy_status',a.status,'url_verified',false)
from studio_core.listing_authoring a
where a.status='listed' and not exists(
 select 1 from studio_core.channel_publication_evidence e where e.inventory_id=a.inventory_id and e.channel='facebook'
);

insert into studio_core.release_manifest(release_name,git_sha,vercel_deployment_id,migration_head,companion_version,companion_sha256,policy_version,manifest,active)
values('capture-20261115','231c27e470cd9369c12729437ff38e2e13eb22b0','dpl_8H62opECqeRoeSWfvUTYPPToMaoT',
 '20261114065610','2.3.0','f373949608092e28e542dea09aecee55cd6f2c3c7d813243e0095e1a2c004d31',
 'mercari-2026-11-15.1',jsonb_build_object('kind','pre-correctness capture'),true)
on conflict(release_name) do nothing;

