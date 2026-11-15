begin;
do $$
declare actor uuid; item text; rev bigint; d jsonb; original text[]; chosen text[]; result jsonb; current_photo bigint;
  old_fields jsonb; old_snapshot jsonb; token text;
begin
 select user_id into strict actor from studio_core.members where enabled limit 1;
 select a.inventory_id,a.revision,a.fields into strict item,rev,old_fields
 from studio_core.listing_authoring a join studio_core.export_sets e using(inventory_id)
 where jsonb_array_length(e.images)>=3 and a.status='review' and trim(a.fields->>'title')<>'' and trim(a.fields->>'description')<>'' and (a.fields->>'price')~'^[1-9][0-9]*$' and a.fields->>'condition'='New' limit 1;
 begin perform public.studio_photo_choices(item); raise exception 'Unauthorized read';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 d:=public.studio_photo_choices(item);
 select array_agg(id order by pos) into original from jsonb_array_elements_text(d->'selected') with ordinality x(id,pos);
 old_snapshot:=public.studio_export_preview(item,rev);
 perform public.studio_approve_export(item,rev,old_snapshot);
 token:=public.studio_issue_handoff(item,rev);
 chosen:=array[original[3],original[1]];
 current_photo:=public.studio_save_photo_choices(item,rev,(d->>'revision')::bigint,chosen);
 result:=public.studio_export_preview(item,rev);
 if (result->'images') is distinct from jsonb_build_array(old_snapshot->'images'->2,old_snapshot->'images'->0) or
 (select fields from studio_core.listing_authoring where inventory_id=item) is distinct from old_fields or
 (select status from studio_core.listing_authoring where inventory_id=item)<>'review' or public.studio_claim_handoff(token) is not null then raise exception 'Approval or exact image mismatch';end if;
 begin perform public.studio_save_photo_choices(item,rev,current_photo-1,original);raise exception 'Stale save accepted';exception when serialization_failure then null;end;
 begin perform public.studio_save_photo_choices(item,rev-1,current_photo,original);raise exception 'Stale seller revision accepted';exception when serialization_failure then null;end;
 begin perform public.studio_save_photo_choices(item,rev,current_photo,array['unknown']);raise exception 'Foreign choice accepted';exception when raise_exception then if sqlerrm<>'Unverified photo choice' then raise;end if;end;
 if public.studio_save_photo_choices(item,rev,current_photo,chosen)<>current_photo then raise exception 'Unchanged save created a revision';end if;
 if public.studio_photo_choices(item)->'previous' is distinct from to_jsonb(original) then raise exception 'Previous selection lost';end if;
 perform public.studio_save_photo_choices(item,rev,current_photo,original);
 if public.studio_export_preview(item,rev)->'images' is distinct from old_snapshot->'images' then raise exception 'Restore mismatch';end if;
end $$;
rollback;
