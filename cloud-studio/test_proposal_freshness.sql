-- Reversible integration test: no seller, selection or evidence changes survive.
begin;
do $$
declare item text; proposal_id bigint; selected jsonb; hashes jsonb;
 prior_fields jsonb; prior_evidence jsonb; state jsonb; stamp bigint; owner_id uuid;
begin
 select user_id into strict owner_id from studio_core.members where enabled limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id)::text,true);
 select p.inventory_id,p.id,s.selection,a.fields,a.revision into strict item,proposal_id,selected,prior_fields,stamp
 from studio_core.field_proposals p
 join studio_core.photo_selection s using(inventory_id)
 join studio_core.listing_authoring a using(inventory_id)
 where p.source='cloud_visual_research' and jsonb_array_length(p.evidence->'photo_hashes')=2
 order by p.id desc limit 1;
 select jsonb_agg(t.sha256 order by t.ord) into hashes from (
  select asset.sha256,x.ord from jsonb_array_elements(selected) with ordinality x(photo,ord)
  join studio_core.photo_assets asset on asset.sha256=photo->>'sha' and asset.cloud_verified_at is not null
  where photo->>'kind'='real' and asset.bytes<=16000000 order by x.ord limit 2
 )t;
 if jsonb_array_length(hashes) is distinct from 2 then raise exception 'Two-source fixture required';end if;
 -- Synthetic proposal is never committed or returned to application clients.
 update studio_core.field_proposals set based_on_revision=stamp,
  evidence=jsonb_build_object('photo_hashes',hashes,'confidence','exact_label',
   'suggestion',jsonb_build_object('model','TEST-FIXTURE'),'observations','[]'::jsonb)
 where id=proposal_id returning evidence into prior_evidence;
 select v into strict state from jsonb_array_elements(studio_core.read_state())v where v->>'id'=item;
 if state->>'proposal_current' is distinct from 'true' or state->'visual_proposal'->'suggestion'->>'model' is distinct from 'TEST-FIXTURE'
 then raise exception 'Current evidence was withheld';end if;
 -- Reordering originals must withhold the old suggestion, even at the same text revision.
 update studio_core.photo_selection set selection=(select jsonb_agg(photo order by ord desc)
  from jsonb_array_elements(selected) with ordinality x(photo,ord)) where inventory_id=item;
 select v into strict state from jsonb_array_elements(studio_core.read_state())v where v->>'id'=item;
 if state->>'proposal_current' is distinct from 'false' or state->'visual_proposal'->'suggestion' is distinct from '{}'::jsonb
 then raise exception 'Reordered photos retained stale suggestion';end if;
 -- Empty source selection must fail closed.
 update studio_core.photo_selection set selection='[]' where inventory_id=item;
 select v into strict state from jsonb_array_elements(studio_core.read_state())v where v->>'id'=item;
 if state->>'proposal_current' is distinct from 'false' or state->'visual_proposal'->'suggestion' is distinct from '{}'::jsonb
 then raise exception 'Missing source photos retained suggestion';end if;
 update studio_core.photo_selection set selection=selected where inventory_id=item;
 -- A missing provenance hash must fail closed, not imply fresh evidence.
 update studio_core.field_proposals set evidence=evidence-'photo_hashes' where id=proposal_id;
 select v into strict state from jsonb_array_elements(studio_core.read_state())v where v->>'id'=item;
 if state->>'proposal_current' is distinct from 'false' or state->'visual_proposal'->'suggestion' is distinct from '{}'::jsonb
 then raise exception 'Missing provenance retained suggestion';end if;
 update studio_core.field_proposals set evidence=prior_evidence,based_on_revision=stamp-1 where id=proposal_id;
 select v into strict state from jsonb_array_elements(studio_core.read_state())v where v->>'id'=item;
 if state->>'proposal_current' is distinct from 'false' or state->'visual_proposal'->'suggestion' is distinct from '{}'::jsonb
 then raise exception 'Old seller revision retained suggestion';end if;
 if prior_fields is distinct from (select fields from studio_core.listing_authoring where inventory_id=item)
 or prior_evidence is distinct from (select evidence from studio_core.field_proposals where id=proposal_id)
 then raise exception 'Read path mutated seller fields or stored evidence';end if;
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform studio_core.read_state();
  raise exception 'Anonymous caller accepted';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
