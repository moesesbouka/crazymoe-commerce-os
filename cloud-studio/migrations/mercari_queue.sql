-- Additive, member-authenticated preparation desk. No Mercari network access.
begin;
create table studio_core.mercari_queue (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 source_kind text not null check(source_kind in ('studio','imported')),
 source_id text not null,
 source_digest text not null,
 source_snapshot jsonb not null,
 draft jsonb not null,
 state text not null check(state in ('needs_details','ready','posted','sold','cancelled')),
 listing_url text,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,source_kind,source_id)
);
create unique index mercari_unique_listing on studio_core.mercari_queue(owner_id,listing_url) where listing_url is not null;
create index mercari_owner_queue on studio_core.mercari_queue(owner_id,created_at,id);
create table studio_core.mercari_presets (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 80), shipping jsonb not null,
 revision integer not null default 1, unique(owner_id,name)
);
create table studio_core.mercari_events (
 id bigint generated always as identity primary key,
 queue_id uuid not null references studio_core.mercari_queue(id), actor uuid not null,
 event text not null, revision integer not null, created_at timestamptz not null default now(),
 payload jsonb not null default '{}'
);
alter table studio_core.mercari_queue enable row level security;
alter table studio_core.mercari_queue force row level security;
alter table studio_core.mercari_presets enable row level security;
alter table studio_core.mercari_presets force row level security;
alter table studio_core.mercari_events enable row level security;
alter table studio_core.mercari_events force row level security;
revoke all on studio_core.mercari_queue,studio_core.mercari_presets,studio_core.mercari_events from public,anon,authenticated,service_role;
create trigger mercari_events_immutable before update or delete or truncate on studio_core.mercari_events
for each statement execute function studio_core.append_only();

create function studio_core.mercari_source(p_kind text,p_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
   'fields',jsonb_build_object('title',a.title,'description',a.description,'price',a.price,'condition',a.condition,'category',a.category),
   'brand','','facebook_id',a.facebook_id,'quantity',a.quantity,
   'photos',coalesce((select jsonb_agg(jsonb_build_object('url',v.url,'kind','imported') order by v.pos) from (
    select distinct on (x.url) x.url,x.pos from jsonb_array_elements_text(coalesce(to_jsonb(a.images),'[]')) with ordinality x(url,pos)
    where starts_with(x.url,'https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/')
    order by x.url,x.pos) v),'[]'::jsonb)) into result
  from public.active_listings a where a.id::text=p_id;
 else raise exception 'Unknown inventory source'; end if;
 if result is null then return null; end if;
 return result||jsonb_build_object('digest',md5(result::text));
end $$;

create function studio_core.mercari_issues(p_draft jsonb,p_source jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
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
 if p_source->>'source_kind'='studio' and coalesce(p_source->>'identity_status','')<>'verified_exact' then issues:=issues||'"Verify the product identity in Studio first"'::jsonb; end if;
 if p_source->>'source_kind'='imported' and not coalesce((p_draft->>'photos_confirmed')::boolean,false) then issues:=issues||'"Confirm imported photos are your own actual product photos"'::jsonb; end if;
 if coalesce(s->>'payer','') not in ('buyer','seller') then issues:=issues||'"Choose who pays shipping"'::jsonb; end if;
 for k in select unnest(array['weight_oz','length_in','width_in','height_in']) loop
  if coalesce(s->>k,'') !~ '^[0-9]{1,5}([.][0-9]{1,2})?$' then issues:=issues||to_jsonb('Enter packed '||replace(k,'_',' '));
  elsif (s->>k)::numeric<=0 then issues:=issues||to_jsonb('Enter positive packed '||replace(k,'_',' ')); end if;
 end loop;
 return issues;
end $$;

create function studio_core.mercari_validate(p_draft jsonb,p_source jsonb) returns void
language plpgsql immutable set search_path='' as $$
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
end $$;

create function studio_core.mercari_inventory(p_kind text,p_query text default '',p_offset integer default 0,p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 200 or length(p_query)>200 or p_kind not in ('studio','imported') then raise exception 'Invalid inventory page'; end if;
 with ids as (
 select i.id from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
 where p_kind='studio' and i.lifecycle='current' and a.status<>'archived'
 and (p_query='' or position(lower(p_query) in lower(a.fields::text||i.id))>0)
 union all
 select a.id::text from public.active_listings a where p_kind='imported' and a.is_active and a.status='active' and coalesce(a.quantity,1)>0
 and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)
 ), page as (select id from ids order by id limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from ids),'items',coalesce((select jsonb_agg(studio_core.mercari_source(p_kind,id) order by id) from page),'[]'::jsonb)) into result;
 return result;
end $$;

create function studio_core.mercari_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 return jsonb_build_object('queue',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object(
  'stale',s.data->>'digest' is distinct from q.source_digest,
  'available',coalesce((s.data->>'available')::boolean,false),'issues',studio_core.mercari_issues(q.draft,s.data)) order by q.created_at,q.id)
  from studio_core.mercari_queue q left join lateral(select studio_core.mercari_source(q.source_kind,q.source_id) data) s on true
  where q.owner_id=auth.uid()),'[]'::jsonb),
 'presets',coalesce((select jsonb_agg(to_jsonb(p)-'owner_id' order by p.name) from studio_core.mercari_presets p where p.owner_id=auth.uid()),'[]'::jsonb));
end $$;

create function studio_core.mercari_prepare(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

create function studio_core.mercari_update(p_id uuid,p_revision integer,p_action text,p_draft jsonb default null,p_url text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  if q.state<>'ready' or studio_core.mercari_issues(q.draft,src)<>'[]'::jsonb then raise exception 'Complete the listing before marking it posted'; end if;
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
end $$;

create function studio_core.mercari_preset(p_name text,p_shipping jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if length(trim(p_name)) not between 1 and 80 or jsonb_typeof(p_shipping) is distinct from 'object' or octet_length(p_shipping::text)>500 then raise exception 'Enter a preset name and packed measurements'; end if;
 if exists(select 1 from jsonb_array_elements_text(studio_core.mercari_issues(jsonb_build_object('shipping',p_shipping),'{}')) x where x like '%packed %' or x='Choose who pays shipping') then raise exception 'Complete the packed weight, dimensions and shipping payer'; end if;
 insert into studio_core.mercari_presets(owner_id,name,shipping) values(auth.uid(),trim(p_name),p_shipping)
 on conflict(owner_id,name) do update set shipping=excluded.shipping,revision=studio_core.mercari_presets.revision+1
 returning to_jsonb(mercari_presets)-'owner_id' into result;
 return result;
end $$;

create function public.studio_mercari_inventory(p_kind text,p_query text default '',p_offset integer default 0,p_limit integer default 100) returns jsonb
language sql security invoker set search_path='' as $$select studio_core.mercari_inventory(p_kind,p_query,p_offset,p_limit)$$;
create function public.studio_mercari_state() returns jsonb language sql security invoker set search_path='' as $$select studio_core.mercari_state()$$;
create function public.studio_mercari_prepare(p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$select studio_core.mercari_prepare(p_rows)$$;
create function public.studio_mercari_update(p_id uuid,p_revision integer,p_action text,p_draft jsonb default null,p_url text default null) returns jsonb
language sql security invoker set search_path='' as $$select studio_core.mercari_update(p_id,p_revision,p_action,p_draft,p_url)$$;
create function public.studio_mercari_preset(p_name text,p_shipping jsonb) returns jsonb
language sql security invoker set search_path='' as $$select studio_core.mercari_preset(p_name,p_shipping)$$;

revoke all on function studio_core.mercari_source(text,text),studio_core.mercari_issues(jsonb,jsonb),studio_core.mercari_validate(jsonb,jsonb),
 studio_core.mercari_inventory(text,text,integer,integer),studio_core.mercari_state(),studio_core.mercari_prepare(jsonb),
 studio_core.mercari_update(uuid,integer,text,jsonb,text),studio_core.mercari_preset(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function studio_core.mercari_inventory(text,text,integer,integer),studio_core.mercari_state(),studio_core.mercari_prepare(jsonb),
 studio_core.mercari_update(uuid,integer,text,jsonb,text),studio_core.mercari_preset(text,jsonb) to authenticated;
revoke all on function public.studio_mercari_inventory(text,text,integer,integer),public.studio_mercari_state(),public.studio_mercari_prepare(jsonb),
 public.studio_mercari_update(uuid,integer,text,jsonb,text),public.studio_mercari_preset(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_mercari_inventory(text,text,integer,integer),public.studio_mercari_state(),public.studio_mercari_prepare(jsonb),
 public.studio_mercari_update(uuid,integer,text,jsonb,text),public.studio_mercari_preset(text,jsonb) to authenticated;
commit;
