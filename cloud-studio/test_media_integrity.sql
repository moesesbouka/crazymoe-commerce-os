begin;

do $$ declare actor uuid; item text; h jsonb; before_count bigint; begin
 begin perform public.studio_media_audit(); raise exception 'Unauthorized audit accepted'; exception when insufficient_privilege then null; end;
 select user_id into strict actor from studio_core.members where enabled limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if jsonb_array_length(public.studio_media_audit()) <> (select count(*) from studio_core.inventory where lifecycle<>'archived') then raise exception 'Audit count mismatch';end if;
 select a.inventory_id into strict item from studio_core.listing_authoring a join studio_core.photo_selection s using(inventory_id) where s.exports_verified and jsonb_array_length(s.selection)>0 and a.status='review' limit 1;
 h:=studio_core.media_health(item);
 if not (h->>'export_ready')::boolean then raise exception 'Existing exports falsely blocked';end if;
 update studio_core.export_sets set images=jsonb_set(images,'{0,sha}',to_jsonb(repeat('0',64))) where inventory_id=item;
 if (studio_core.media_health(item)->>'export_ready')::boolean then raise exception 'Missing object accepted';end if;
 begin perform studio_core.assert_releasable_photo_identity(item);raise exception 'Missing media approved';exception when check_violation then null;end;
 if has_function_privilege('anon','public.studio_media_audit()','execute') or has_function_privilege('authenticated','public.studio_append_manual_photo(uuid,text,bigint,jsonb,text)','execute') then raise exception 'Unexpected access grant';end if;
end $$;
rollback;
