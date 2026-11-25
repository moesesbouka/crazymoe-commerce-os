begin;
do $$
declare item text:='test-retry-'||gen_random_uuid(); owner_id uuid; photo text; original uuid; retried uuid;
begin
 select user_id into strict owner_id from studio_core.members where enabled limit 1;
 select sha256 into strict photo from studio_core.photo_assets where cloud_verified_at is not null and bytes between 1 and 16000000 limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id)::text,true);
 insert into studio_core.inventory(id) values(item);
 insert into studio_core.listing_authoring(inventory_id,fields) values(item,'{"title":"Retry fixture"}');
 insert into studio_core.photo_selection(inventory_id,selection) values(item,jsonb_build_array(jsonb_build_object('kind','real','sha',photo)));
 original:=public.studio_request_render(item,1,1);
 update studio_core.jobs set state='failed',attempts=3,last_error='Synthetic failure' where id=original;
 if public.studio_render_status(item)->>'retry_job'<>original::text then raise exception 'Retry unavailable';end if;
 retried:=public.studio_retry_render(item,1,1,original);
 if retried=original or (select attempts from studio_core.jobs where id=original)<>3 then raise exception 'History overwritten';end if;
 if public.studio_retry_render(item,1,1,original)<>retried then raise exception 'Duplicate retry';end if;
 if (select payload->>'retry_of' from studio_core.jobs where id=retried)<>original::text then raise exception 'Provenance missing';end if;
 if public.studio_render_status(item)->>'state'<>'queued' then raise exception 'Retry not displayed';end if;
 begin perform public.studio_retry_render(item,2,1,original);raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 begin perform public.studio_render_finish(original,3,'[]',null);raise exception 'Late worker accepted';exception when raise_exception then if sqlerrm='Late worker accepted' then raise;end if;end;
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.studio_retry_render(item,1,1,original);raise exception 'Anonymous retry accepted';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.studio_retry_render(text,bigint,bigint,uuid)','EXECUTE') then raise exception 'Anonymous grant';end if;
end $$;
rollback;
