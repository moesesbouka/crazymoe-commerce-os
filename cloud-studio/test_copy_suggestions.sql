begin;
do $$ declare actor uuid; item text; rev bigint; before_fields jsonb; result jsonb; begin
 result:=studio_core.clean_copy(E'PRODUCT OVERVIEW\nPhilips fixture\nINTERNAL VERIFICATION NOTES\nExact model uncertain\nExposed wiring. Needs repair.\nCONDITION\nNot tested.\nBest Buy SKU: 123\nRetailer status: unavailable\nACTUAL ITEM / LIMITATIONS\nCarton 1 of 2; missing hardware.');
 if result->>'description' like '%SKU%' or result->>'description' like '%Exact model uncertain%' or result->>'description' like '%ACTUAL ITEM%' then raise exception 'Internal copy leaked';end if;
 if result->>'description' not like '%Exposed wiring%' or result->>'description' not like '%Not tested%' or result->>'description' not like '%missing hardware%' then raise exception 'Material disclosure removed';end if;
 begin perform public.studio_refresh_copy_suggestion('absent',1);raise exception 'Unauthorized write';exception when insufficient_privilege then null;end;
 select user_id into strict actor from studio_core.members where enabled limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select inventory_id,revision,fields into strict item,rev,before_fields from studio_core.listing_authoring where length(fields->>'description')>20 and status='review' limit 1;
 result:=public.studio_refresh_copy_suggestion(item,rev);
 if (select fields from studio_core.listing_authoring where inventory_id=item) is distinct from before_fields then raise exception 'Seller description overwritten';end if;
 begin perform public.studio_refresh_copy_suggestion(item,rev+1);raise exception 'Stale candidate accepted';exception when serialization_failure then null;end;
 if has_function_privilege('anon','public.studio_refresh_copy_suggestion(text,bigint)','execute') then raise exception 'Anonymous write exposed';end if;
end $$;
rollback;
