CREATE OR REPLACE FUNCTION studio_core.read_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=auth.uid() AND enabled) THEN
  RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'lifecycle',i.lifecycle,'fields',a.fields,'revision',a.revision,'status',a.status,
  'generated_candidate',g.fields,'identity',p.identity,'identity_status',p.verification_status,
  'research',r.research,
  -- Historical evidence remains intact; stale proposals are never offered as edits.
  'visual_proposal',CASE WHEN v.evidence IS NULL THEN NULL
   WHEN fresh.valid THEN v.evidence ELSE v.evidence || jsonb_build_object(
    'suggestion','{}'::jsonb,'confidence','stale',
    'observations',coalesce(v.evidence->'observations','[]'::jsonb) ||
     jsonb_build_array('Listing or source photos changed. Run identification again before using a suggestion.')) END,
  'proposal_revision',v.based_on_revision,'proposal_current',coalesce(fresh.valid,false),
  'photo_selection',s.selection,'exports_verified',s.exports_verified
 ) ORDER BY i.id),'[]'::jsonb)
 FROM studio_core.inventory i JOIN studio_core.listing_authoring a ON a.inventory_id=i.id
 LEFT JOIN studio_core.generated_copy g ON g.inventory_id=i.id
 LEFT JOIN studio_core.product_identity p ON p.inventory_id=i.id
 LEFT JOIN studio_core.research_evidence r ON r.inventory_id=i.id
 LEFT JOIN LATERAL (SELECT evidence,based_on_revision FROM studio_core.field_proposals
 WHERE inventory_id=i.id AND source='cloud_visual_research' ORDER BY id DESC LIMIT 1) v ON true
 LEFT JOIN studio_core.photo_selection s ON s.inventory_id=i.id
 LEFT JOIN LATERAL (
  SELECT coalesce(jsonb_agg(t.sha256 ORDER BY t.ord),'[]'::jsonb) hashes FROM (
   -- Match the bounded, ordered originals used by studio_worker_claim.
   SELECT asset.sha256,x.ord
   FROM jsonb_array_elements(s.selection) WITH ORDINALITY x(photo,ord)
   JOIN studio_core.photo_assets asset ON asset.sha256=photo->>'sha'
    AND asset.cloud_verified_at IS NOT NULL
   WHERE photo->>'kind'='real' AND asset.bytes<=16000000
   ORDER BY x.ord LIMIT 2
  ) t
 ) photos ON true
 LEFT JOIN LATERAL (SELECT v.based_on_revision=a.revision
  AND photos.hashes<>'[]'::jsonb AND v.evidence->'photo_hashes'=photos.hashes AS valid) fresh ON true);
END; $$;

CREATE FUNCTION studio_core.reference_access(p_item text,p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT studio_core.is_member() THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('bucket',bucket,'path',object_path,'sha256',sha256)
 FROM studio_core.reference_assets WHERE inventory_id=p_item AND reference_id=p_reference);
END; $$;
CREATE FUNCTION public.studio_reference_access(p_item text,p_reference text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT studio_core.reference_access(p_item,p_reference); $$;
REVOKE ALL ON FUNCTION studio_core.reference_access(text,text),public.studio_reference_access(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION studio_core.reference_access(text,text),public.studio_reference_access(text,text) TO authenticated;
