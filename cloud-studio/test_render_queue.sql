begin;
do $$
declare item text:='test-render-'||replace(gen_random_uuid()::text,'-',''); owner_id uuid;
 photo text; output jsonb; j uuid; claimed jsonb; token text; fields_before jsonb;
begin
 select user_id into strict owner_id from studio_core.members where enabled limit 1;
 select sha256 into strict photo from studio_core.photo_assets where cloud_verified_at is not null and bytes<=16000000 limit 1;
 select images->0 into strict output from studio_core.export_sets limit 1;
 select decrypted_secret into strict token from vault.decrypted_secrets where name='studio_worker_token';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id)::text,true);
 insert into studio_core.inventory(id) values(item);
 insert into studio_core.listing_authoring(inventory_id,fields) values(item,'{"title":"Synthetic queue test","condition":"New"}');
 insert into studio_core.photo_selection(inventory_id,selection) values(item,jsonb_build_array(jsonb_build_object('kind','real','sha',photo)));
 fields_before:=(select fields from studio_core.listing_authoring where inventory_id=item);
 j:=public.studio_request_render(item,1,1);
 if public.studio_request_render(item,1,1)<>j then raise exception 'Duplicate request created another job';end if;
 begin perform public.studio_request_render(item,2,1);raise exception 'Stale editor accepted';exception when serialization_failure then null;end;
 begin perform public.studio_render_claim('invalid');raise exception 'Bad worker token accepted';exception when insufficient_privilege then null;end;
 -- Fixture must not claim another run's real work.
 if exists(select 1 from studio_core.jobs where kind='render' and id<>j and state in ('queued','running')) then raise exception 'Another renderer is active';end if;
 claimed:=public.studio_render_claim(token);
 if claimed->>'id'<>j::text or claimed->>'attempt'<>'1' then raise exception 'Claim mismatch';end if;
 if public.studio_render_claim(token) is not null then raise exception 'Active lease was claimed twice';end if;
 begin perform public.studio_render_finish(j,2,'[]',null);raise exception 'Stale attempt accepted';exception when raise_exception then if sqlerrm='Stale attempt accepted' then raise;end if;end;
 begin perform public.studio_render_finish(j,1,'[]',null);raise exception 'Incomplete set accepted';exception when raise_exception then if sqlerrm='Incomplete set accepted' then raise;end if;end;
 -- Simulate a changed photo revision while the cloud render is in flight.
 update studio_core.photo_selection set revision=2 where inventory_id=item;
 if public.studio_render_finish(j,1,'[]',null) then raise exception 'Stale render registered';end if;
 if exists(select 1 from studio_core.export_sets where inventory_id=item) then raise exception 'Stale export written';end if;
 j:=public.studio_request_render(item,1,2);claimed:=public.studio_render_claim(token);
 -- Use an existing verified storage object solely as a transactional receipt fixture.
 output:=output||jsonb_build_object('source_sha',photo,'recipe','existing-finish-v4-pop-v1-cloud1');
 if not public.studio_render_finish(j,1,jsonb_build_array(output),null) then raise exception 'Valid receipt rejected';end if;
 if not (select exports_verified from studio_core.photo_selection where inventory_id=item)
 or (select status from studio_core.listing_authoring where inventory_id=item)<>'review'
 or (select fields from studio_core.listing_authoring where inventory_id=item) is distinct from fields_before then raise exception 'Seller/approval isolation failed';end if;
 begin perform public.studio_request_render(item,1,2);raise exception 'Verified exports replaced';exception when raise_exception then if sqlerrm='Verified exports replaced' then raise;end if;end;
 if has_function_privilege('anon','public.studio_request_render(text,bigint,bigint)','EXECUTE')
 or has_function_privilege('authenticated','public.studio_render_finish(uuid,int,jsonb,text)','EXECUTE') then raise exception 'Unsafe grants';end if;
 perform set_config('request.jwt.claims','{}',true);
 begin perform public.studio_request_render(item,1,2);raise exception 'Anonymous request accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
