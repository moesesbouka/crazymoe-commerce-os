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
