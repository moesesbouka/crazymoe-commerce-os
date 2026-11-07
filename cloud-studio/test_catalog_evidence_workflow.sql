begin;
do $$
declare actor uuid; item text; listing_revision bigint; identity_revision bigint; before_fields jsonb;
 first jsonb; second jsonb; evidence jsonb:='{"claim":"synthetic rollback-only evidence"}';
begin
 select user_id into strict actor from studio_core.members where enabled order by user_id limit 1;
 select a.inventory_id,a.revision,p.revision,a.fields into strict item,listing_revision,identity_revision,before_fields
 from studio_core.listing_authoring a join studio_core.product_identity p using(inventory_id) order by a.inventory_id limit 1;
 begin perform studio_core.add_catalog_evidence(item,listing_revision,identity_revision,'manufacturer','https://example.com/probe','Probe','Brand','Model',evidence);
  raise exception 'Nonmember accepted'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 first:=studio_core.add_catalog_evidence(item,listing_revision,identity_revision,'manufacturer','https://example.com/probe','Probe','Brand','Model',evidence);
 second:=studio_core.add_catalog_evidence(item,listing_revision,identity_revision,'manufacturer','https://example.com/probe','Probe','Brand','Model',evidence);
 if first->>'id' is distinct from second->>'id' then raise exception 'Idempotency failed'; end if;
 if (select count(*) from studio_core.catalog_evidence where inventory_id=item and url='https://example.com/probe')<>1 then raise exception 'Duplicate evidence'; end if;
 begin perform studio_core.add_catalog_evidence(item,listing_revision+1,identity_revision,'retailer','https://example.com/stale','Probe','Brand','Model',evidence);
  raise exception 'Stale listing accepted'; exception when serialization_failure then null; end;
 begin perform studio_core.add_catalog_evidence(item,listing_revision,identity_revision+1,'retailer','https://example.com/stale','Probe','Brand','Model',evidence);
  raise exception 'Stale identity accepted'; exception when serialization_failure then null; end;
 begin perform studio_core.add_catalog_evidence(item,listing_revision,identity_revision,'retailer','http://example.com/unsafe','Probe','Brand','Model',evidence);
  raise exception 'Unsafe URL accepted'; exception when raise_exception then if sqlerrm<>'Invalid catalog evidence' then raise; end if; end;
 if before_fields is distinct from (select fields from studio_core.listing_authoring where inventory_id=item) then raise exception 'Seller fields changed'; end if;
 if has_table_privilege('anon','studio_core.catalog_evidence','SELECT')
  or has_table_privilege('authenticated','studio_core.catalog_evidence','SELECT')
  or has_function_privilege('anon','public.studio_add_catalog_evidence(text,bigint,bigint,text,text,text,text,text,jsonb)','EXECUTE') then
  raise exception 'Evidence permissions exposed'; end if;
end $$;
rollback;
