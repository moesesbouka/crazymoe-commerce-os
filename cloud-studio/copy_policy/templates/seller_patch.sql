CREATE OR REPLACE FUNCTION studio_core.seller_patch(p_id text, p_expected_revision bigint, p_patch jsonb, p_reason text DEFAULT 'seller edit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE old_row studio_core.listing_authoring%ROWTYPE; merged jsonb; actor_id uuid := auth.uid(); k text;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=actor_id AND enabled) THEN
    RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'Patch must be a nonempty object';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('title','description','price','condition','notes','model','category','source_url') OR jsonb_typeof(p_patch->k)<>'string' THEN
      RAISE EXCEPTION 'Unsupported field or non-string value: %',k;
    END IF;
  END LOOP;
  SELECT * INTO old_row FROM studio_core.listing_authoring WHERE inventory_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory not found'; END IF;
  IF p_expected_revision IS NULL OR old_row.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Listing changed; refresh before saving' USING ERRCODE='40001';
  END IF;
  merged := old_row.fields || p_patch;
  INSERT INTO studio_core.listing_revisions(inventory_id,before_revision,after_revision,old_fields,new_fields,actor,reason)
  VALUES(p_id,old_row.revision,old_row.revision+1,old_row.fields,merged,actor_id,coalesce(p_reason,'seller edit'));
  INSERT INTO studio_core.field_provenance(inventory_id,field_name,source,actor,protected)
  SELECT p_id,key,'seller',actor_id::text,true FROM jsonb_each(p_patch)
  ON CONFLICT(inventory_id,field_name) DO UPDATE SET source='seller',actor=excluded.actor,protected=true,updated_at=now();
  IF old_row.status='approved' THEN
    INSERT INTO studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
    VALUES(p_id,'invalidated',old_row.revision,jsonb_build_object('reason','seller content changed'),actor_id);
  END IF;
  UPDATE studio_core.listing_authoring SET fields=merged,revision=revision+1,
    status=CASE WHEN status='listed' THEN 'listed' ELSE 'review' END,updated_at=now() WHERE inventory_id=p_id;
  RETURN jsonb_build_object('id',p_id,'revision',old_row.revision+1,'fields',merged);
END; $function$
