begin;
do $$
declare actor uuid; item text; rev bigint; result jsonb; before_fields jsonb; f jsonb;
begin
 result:=studio_core.clean_copy(E'Lasko CW105 heater.\nMODEL FEATURES: 1500 W; timer.\nACTUAL WAREHOUSE UNIT: visibly worn box; accessories NOT confirmed. Cosmetic condition untested.');
 if result->>'description'<>E'Lasko CW105 heater.\nMODEL FEATURES: 1500 W; timer.' or result->>'internal_notes'<>'' then raise exception 'Automated inspection survived: %',result;end if;
 if studio_core.machine_text('Roon Tested and separate subwoofer output')<>'Roon Tested and separate subwoofer output' then raise exception 'Manufacturer feature removed';end if;
 if studio_core.machine_text('1000 W amplifier (peak; not measured on this item)')<>'1000 W amplifier (peak)' then raise exception 'Manufacturer rating lost';end if;
 if studio_core.machine_text('Safe - Lock Untested','title')<>'Safe' then raise exception 'Title assessment survived';end if;
 select user_id into strict actor from studio_core.members where role='owner' and enabled;
 select inventory_id,revision,fields into strict item,rev,before_fields from studio_core.listing_authoring where status='review' order by inventory_id limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 result:=public.studio_seller_patch(item,rev,'{"description":"My manual note: cosmetic scuff, untested.","notes":"I entered this manually: accessories missing.","condition":"Used - Good"}');
 if result->'fields'->>'notes'<>'I entered this manually: accessories missing.' or result->'fields'->>'description'<>'My manual note: cosmetic scuff, untested.' then raise exception 'Manual text changed';end if;
 if (select fields from studio_core.listing_authoring where inventory_id=item) is distinct from result->'fields' then raise exception 'Manual response differs from persistence';end if;
 update studio_core.listing_authoring set fields=fields||'{"notes":"Machine inspection","condition":"For parts or not working","description":"1500 W heater. Cosmetic condition untested."}' where inventory_id=item;
 select fields into f from studio_core.listing_authoring where inventory_id=item;
 if f->>'notes'<>'I entered this manually: accessories missing.' or f->>'condition'<>'Used - Good' or f->>'description'<>'My manual note: cosmetic scuff, untested.' then raise exception 'Machine write bypassed manual boundary: %',f;end if;
 insert into studio_core.generated_copy(inventory_id,fields,source,based_on_revision) values(item,'{"title":"Heater - Untested","description":"1500 W heater.\nACTUAL WAREHOUSE UNIT: worn box.","notes":"Internal notes","condition":"Used - Fair"}','regression',rev+1)
 on conflict(inventory_id) do update set fields=excluded.fields;
 select fields into f from studio_core.generated_copy where inventory_id=item;
 if f ? 'notes' or f ? 'condition' or f->>'title'<>'Heater' or f->>'description'<>'1500 W heater.' then raise exception 'Generated notes persisted: %',f;end if;
 insert into studio_core.field_proposals(inventory_id,fields,source,based_on_revision,evidence) values(item,'{"notes":"AI note","description":"Heater. Untested."}','regression',rev+1,'{"observations":["worn"],"needs_seller_input":["test"],"nested":{"internal_notes":"private"},"photo_hashes":["abc"]}');
 select evidence into f from studio_core.field_proposals where inventory_id=item and source='regression' order by id desc limit 1;
 if f::text like '%worn%' or f::text like '%private%' or f->'photo_hashes'<>'["abc"]' then raise exception 'Evidence notes survived: %',f;end if;
 begin perform public.studio_seller_patch(item,rev,'{"notes":"stale"}');raise exception 'Stale edit accepted';exception when serialization_failure then null;end;
 perform public.studio_seller_patch(item,rev+1,'{"description":"1500 W heater."}');
 result:=public.studio_refresh_copy_suggestion(item,rev+2);
 if result->>'description' like '%untested%' then raise exception 'Refresh generated notes';end if;
 if has_function_privilege('authenticated','studio_core.machine_fields(jsonb)','execute') then raise exception 'Private helper exposed';end if;
end $$;
rollback;
select 'Manual text, automated writes, suggestions, stale edits, and access checks passed; test writes rolled back' result;
