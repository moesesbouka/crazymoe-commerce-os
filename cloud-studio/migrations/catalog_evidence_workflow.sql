-- Member-recorded manufacturer and retailer evidence. Evidence never writes
-- seller listing fields or changes an identity decision automatically.
create table studio_core.catalog_evidence (
 id bigint generated always as identity primary key,
 inventory_id text not null references studio_core.inventory(id),
 source_kind text not null check(source_kind in ('manufacturer','retailer')),
 url text not null check(octet_length(url) between 10 and 2048 and url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?/[^[:space:]@]*$'),
 product_name text not null check(octet_length(product_name) between 1 and 500),
 brand text not null check(octet_length(brand) between 1 and 200),
 model text not null check(octet_length(model) between 1 and 200),
 evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=65536),
 based_on_listing_revision bigint not null,
 based_on_identity_revision bigint not null,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 unique(inventory_id,source_kind,url,based_on_listing_revision,based_on_identity_revision)
);
create index catalog_evidence_item on studio_core.catalog_evidence(inventory_id,id desc);
alter table studio_core.catalog_evidence enable row level security;
alter table studio_core.catalog_evidence force row level security;
revoke all on studio_core.catalog_evidence from public,anon,authenticated,service_role;
revoke all on sequence studio_core.catalog_evidence_id_seq from public,anon,authenticated,service_role;

create function studio_core.add_catalog_evidence(
 p_item text,p_listing_revision bigint,p_identity_revision bigint,p_source_kind text,
 p_url text,p_product_name text,p_brand text,p_model text,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare listing studio_core.listing_authoring; identity studio_core.product_identity; saved studio_core.catalog_evidence;
 normalized_url text:=trim(p_url); normalized_name text:=trim(p_product_name);
 normalized_brand text:=trim(p_brand); normalized_model text:=trim(p_model);
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into listing from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into identity from studio_core.product_identity where inventory_id=p_item for update;
 if listing.inventory_id is null or identity.inventory_id is null then raise exception 'Product unavailable' using errcode='P0002'; end if;
 if listing.revision<>p_listing_revision or identity.revision<>p_identity_revision then
  raise exception 'Product changed. Refresh before recording evidence.' using errcode='40001';
 end if;
 if p_source_kind not in ('manufacturer','retailer') or normalized_url is null
  or octet_length(normalized_url) not between 10 and 2048
  or normalized_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?/[^[:space:]@]*$'
  or octet_length(normalized_name) not between 1 and 500
  or octet_length(normalized_brand) not between 1 and 200
  or octet_length(normalized_model) not between 1 and 200
  or jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>65536 then
  raise exception 'Invalid catalog evidence';
 end if;
 insert into studio_core.catalog_evidence(inventory_id,source_kind,url,product_name,brand,model,evidence,
  based_on_listing_revision,based_on_identity_revision,recorded_by)
 values(p_item,p_source_kind,normalized_url,normalized_name,normalized_brand,normalized_model,p_evidence,
  p_listing_revision,p_identity_revision,auth.uid())
 on conflict(inventory_id,source_kind,url,based_on_listing_revision,based_on_identity_revision) do nothing
 returning * into saved;
 if saved.id is null then
  select * into strict saved from studio_core.catalog_evidence where inventory_id=p_item and source_kind=p_source_kind
   and url=normalized_url and based_on_listing_revision=p_listing_revision and based_on_identity_revision=p_identity_revision;
  if saved.product_name<>normalized_name or saved.brand<>normalized_brand or saved.model<>normalized_model
   or saved.evidence is distinct from p_evidence then raise exception 'Evidence URL already recorded with different facts' using errcode='23505'; end if;
 end if;
 return jsonb_build_object('id',saved.id,'inventory_id',saved.inventory_id,'source_kind',saved.source_kind,
  'url',saved.url,'product_name',saved.product_name,'brand',saved.brand,'model',saved.model,
  'based_on_listing_revision',saved.based_on_listing_revision,'based_on_identity_revision',saved.based_on_identity_revision,
  'recorded_at',saved.recorded_at);
end $$;
revoke all on function studio_core.add_catalog_evidence(text,bigint,bigint,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function studio_core.add_catalog_evidence(text,bigint,bigint,text,text,text,text,text,jsonb) to authenticated;
create function public.studio_add_catalog_evidence(
 p_item text,p_listing_revision bigint,p_identity_revision bigint,p_source_kind text,
 p_url text,p_product_name text,p_brand text,p_model text,p_evidence jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select studio_core.add_catalog_evidence(p_item,p_listing_revision,p_identity_revision,p_source_kind,
  p_url,p_product_name,p_brand,p_model,p_evidence);
$$;
revoke all on function public.studio_add_catalog_evidence(text,bigint,bigint,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_add_catalog_evidence(text,bigint,bigint,text,text,text,text,text,jsonb) to authenticated;

create or replace function studio_core.read_state() returns jsonb
language plpgsql security definer set search_path='' as $$
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
  'photo_selection',s.selection,'exports_verified',s.exports_verified
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
end $$;
revoke all on function studio_core.read_state() from public,anon,authenticated,service_role;
grant execute on function studio_core.read_state() to authenticated;
