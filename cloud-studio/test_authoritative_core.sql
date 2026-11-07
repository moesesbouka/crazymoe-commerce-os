-- Integration assertions on copied data. All test mutations are rolled back.
BEGIN;
DO $$
DECLARE target text; old_revision bigint; owner_id uuid; first_event bigint;
 old_fields jsonb; candidate jsonb; result jsonb; revised jsonb;
BEGIN
 SELECT user_id INTO STRICT owner_id FROM studio_core.members WHERE role='owner' AND enabled;
 SELECT inventory_id,revision,fields INTO STRICT target,old_revision,old_fields
 FROM studio_core.listing_authoring ORDER BY inventory_id LIMIT 1;
 SELECT fields INTO candidate FROM studio_core.generated_copy WHERE inventory_id=target;
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN
  PERFORM studio_core.seller_patch(target,old_revision,'{"title":"unauthorized"}');
  RAISE EXCEPTION 'TEST FAILED: anonymous edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 BEGIN
  PERFORM studio_core.seller_patch(target,old_revision,'{"title":"unauthorized"}');
  RAISE EXCEPTION 'TEST FAILED: nonmember edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 UPDATE studio_core.listing_authoring SET status='approved' WHERE inventory_id=target;
 result:=studio_core.seller_patch(target,old_revision,'{"title":"Cloud regression marker","description":""}');
 IF result->>'revision'<>(old_revision+1)::text THEN RAISE EXCEPTION 'Revision did not advance'; END IF;
 IF result->'fields'->>'description'<>'' THEN RAISE EXCEPTION 'Explicit clear lost'; END IF;
 IF EXISTS(SELECT 1 FROM studio_core.listing_authoring WHERE inventory_id=target AND status<>'review') THEN
  RAISE EXCEPTION 'Approval not invalidated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM studio_core.approval_events WHERE inventory_id=target AND event='invalidated') THEN
  RAISE EXCEPTION 'Invalidation not audited'; END IF;
 IF (SELECT fields FROM studio_core.generated_copy WHERE inventory_id=target) IS DISTINCT FROM candidate THEN
  RAISE EXCEPTION 'Seller edit changed generated candidate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM studio_core.field_provenance WHERE inventory_id=target AND field_name='description' AND protected AND source='seller') THEN
  RAISE EXCEPTION 'Seller provenance missing'; END IF;
 BEGIN
  PERFORM studio_core.seller_patch(target,old_revision,'{"title":"stale editor"}');
  RAISE EXCEPTION 'TEST FAILED: stale edit accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 SELECT id INTO first_event FROM studio_core.listing_revisions WHERE inventory_id=target AND after_revision=old_revision+1;
 revised:=studio_core.rollback_fields(target,old_revision+1,first_event);
 IF revised->'fields'->>'title' IS DISTINCT FROM coalesce(old_fields->>'title','') THEN
  RAISE EXCEPTION 'Rollback title differs'; END IF;
 IF (SELECT count(*) FROM studio_core.listing_revisions WHERE inventory_id=target AND after_revision>old_revision)<>2 THEN
  RAISE EXCEPTION 'Rollback did not append history'; END IF;
 BEGIN
  UPDATE studio_core.listing_revisions SET reason='tamper' WHERE id=first_event;
  RAISE EXCEPTION 'TEST FAILED: revision changed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Studio history is append-only' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE rolname IN ('anon','authenticated','service_role')
  AND has_table_privilege(r.oid,'studio_core.listing_authoring','update')) THEN
  RAISE EXCEPTION 'Private core exposed to clients'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE rolname IN ('anon','service_role')
  AND has_function_privilege(r.oid,'public.studio_seller_patch(text,bigint,jsonb)','execute')) THEN
  RAISE EXCEPTION 'Seller command exposed to a non-seller role'; END IF;
END; $$;
ROLLBACK;
SELECT 'private core integration assertions passed; mutations rolled back' AS result;
