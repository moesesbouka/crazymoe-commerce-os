CREATE FUNCTION studio_core.read_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=auth.uid() AND enabled) THEN
  RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'lifecycle',i.lifecycle,'fields',a.fields,'revision',a.revision,'status',a.status,
  'generated_candidate',g.fields,'identity',p.identity,'identity_status',p.verification_status,
  'research',r.research,'photo_selection',s.selection,'exports_verified',s.exports_verified
 ) ORDER BY i.id),'[]'::jsonb)
 FROM studio_core.inventory i JOIN studio_core.listing_authoring a ON a.inventory_id=i.id
 LEFT JOIN studio_core.generated_copy g ON g.inventory_id=i.id
 LEFT JOIN studio_core.product_identity p ON p.inventory_id=i.id
 LEFT JOIN studio_core.research_evidence r ON r.inventory_id=i.id
 LEFT JOIN studio_core.photo_selection s ON s.inventory_id=i.id);
END; $$;
CREATE FUNCTION studio_core.asset_access(p_sha text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=auth.uid() AND enabled) THEN
  RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT jsonb_build_object('bucket',bucket,'path',object_path,'bytes',bytes,'sha256',sha256)
 FROM studio_core.photo_assets WHERE sha256=p_sha AND cloud_verified_at IS NOT NULL);
END; $$;

CREATE FUNCTION public.studio_state() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT studio_core.read_state(); $$;
CREATE FUNCTION public.studio_seller_patch(p_id text,p_expected_revision bigint,p_patch jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT studio_core.seller_patch(p_id,p_expected_revision,p_patch); $$;
CREATE FUNCTION public.studio_rollback(p_id text,p_expected_revision bigint,p_event bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT studio_core.rollback_fields(p_id,p_expected_revision,p_event); $$;
CREATE FUNCTION public.studio_asset_access(p_sha text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT studio_core.asset_access(p_sha); $$;

REVOKE ALL ON FUNCTION studio_core.read_state(),studio_core.asset_access(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.studio_state(),public.studio_seller_patch(text,bigint,jsonb),public.studio_rollback(text,bigint,bigint),public.studio_asset_access(text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA studio_core TO authenticated;
GRANT EXECUTE ON FUNCTION studio_core.read_state(),studio_core.asset_access(text),studio_core.seller_patch(text,bigint,jsonb,text),studio_core.rollback_fields(text,bigint,bigint)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.studio_state(),public.studio_seller_patch(text,bigint,jsonb),public.studio_rollback(text,bigint,bigint),public.studio_asset_access(text)
TO authenticated;
