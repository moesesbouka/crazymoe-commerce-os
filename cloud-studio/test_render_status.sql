begin;
do $$
declare owner_id uuid; existing text; item text:='test-status-'||gen_random_uuid(); result jsonb;
begin
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.studio_render_status(item);raise exception 'Anonymous status exposed';exception when insufficient_privilege then null;end;
 select user_id into strict owner_id from studio_core.members where enabled limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id)::text,true);
 select inventory_id into strict existing from studio_core.export_sets limit 1;
 if public.studio_render_status(existing)->>'state'<>'ready' then raise exception 'Verified exports not ready';end if;
 insert into studio_core.inventory(id) values(item);
 insert into studio_core.listing_authoring(inventory_id,fields) values(item,'{"title":"Status fixture"}');
 insert into studio_core.photo_selection(inventory_id,selection) values(item,'[]');
 if public.studio_render_status(item)->>'state'<>'needs_photos' then raise exception 'Missing photos misreported';end if;
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload)
 values(item,'render',item,jsonb_build_object('listing_revision',1,'photo_revision',1));
 if public.studio_render_status(item)->>'state'<>'queued' then raise exception 'Queued status incorrect';end if;
 update studio_core.jobs set state='running' where inventory_id=item;
 if public.studio_render_status(item)->>'state'<>'running' then raise exception 'Running status incorrect';end if;
 update studio_core.jobs set state='failed' where inventory_id=item;
 if public.studio_render_status(item)->>'state'<>'failed' then raise exception 'Failure status incorrect';end if;
 update studio_core.listing_authoring set revision=2 where inventory_id=item;
 result:=public.studio_render_status(item);
 if result->>'state'<>'needs_photos' or result->>'revision'<>'2' then raise exception 'Old job leaked into new revision';end if;
 if has_function_privilege('anon','public.studio_render_status(text)','EXECUTE') then raise exception 'Anonymous grant';end if;
end $$;
rollback;
