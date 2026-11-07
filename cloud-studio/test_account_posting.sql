-- Transactional integration test. All fixtures and queue records roll back.
begin;
do $$
declare member uuid; account uuid; source_id bigint:=-90711001; inventory jsonb; prepared jsonb; packet jsonb; copy_id uuid; token text; result jsonb;
begin
 select user_id into strict member from studio_core.members where enabled limit 1;
 perform set_config('request.jwt.claim.sub',member::text,true);
 insert into public.active_listings(id,facebook_id,account_tag,title,description,price,condition,images,status,is_active,quantity)
 values(source_id,'9000000000000001','posting_test_source','Test speaker — Black','Used. Cracked glass. Remote included.',125,'Used - Fair',
 array['https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/test/fixture.jpg'],'active',true,1);
 execute 'set local role authenticated';
 result:=public.studio_posting_accounts('TEST ONLY','9000000000000002','posting_test_destination');
 select (value->>'id')::uuid into strict account from jsonb_array_elements(result) where value->>'profile_id'='9000000000000002';
 inventory:=public.studio_posting_inventory('Test speaker',0,10);
 select value into strict prepared from jsonb_array_elements(inventory->'items') where (value->>'id')::bigint=source_id;
 result:=public.studio_posting_prepare(account,jsonb_build_array(jsonb_build_object('source_id',source_id,'digest',prepared->>'digest','draft',
  jsonb_build_object('title','Black — Test speaker','description','Used. Cracked glass. Remote included.','price',1,'condition','New','images',prepared->'images'))));
 copy_id:=(result->>0)::uuid;
 result:=public.studio_posting_queue();
 select value into packet from jsonb_array_elements(result) where value->>'id'=copy_id::text;
 if (packet->'draft'->>'price')::numeric is distinct from 125::numeric or packet->'draft'->>'condition' is distinct from 'Used - Fair' then raise exception 'FAIL: source facts changed: %',packet; end if;
 packet:=public.studio_posting_claim(copy_id,1);token:=packet->>'token';
 begin
  perform public.studio_posting_claim(copy_id,1);raise exception 'FAIL: repeat claim allowed';
 exception when raise_exception then if SQLERRM like 'FAIL:%' then raise; end if; end;
 begin
  perform public.studio_posting_transfer(token,'read','{}');raise exception 'FAIL: authenticated transfer callable';
 exception when insufficient_privilege then null; end;
 execute 'reset role';execute 'set local role service_role';
 packet:=public.studio_posting_transfer(token,'read','{}');
 if packet->>'profile_id'<>'9000000000000002' then raise exception 'FAIL: wrong destination'; end if;
 begin
  perform public.studio_posting_transfer(token,'filled','{"profile_id":"9000000000000003","photo_count":1}');raise exception 'FAIL: wrong profile accepted';
 exception when raise_exception then if SQLERRM like 'FAIL:%' then raise; end if; end;
 perform public.studio_posting_transfer(token,'filled','{"profile_id":"9000000000000002","photo_count":1}');
 begin
  perform public.studio_posting_transfer(token,'read','{}');raise exception 'FAIL: completed capability replay';
 exception when raise_exception then if SQLERRM like 'FAIL:%' then raise; end if; end;
 execute 'reset role';execute 'set local role authenticated';
 result:=public.studio_posting_queue();
 select value into packet from jsonb_array_elements(result) where value->>'id'=copy_id::text;
 if packet->>'state'<>'filled' then raise exception 'FAIL: filled was marked published'; end if;
 perform public.studio_posting_result(copy_id,1,'submitted','https://www.facebook.com/marketplace/item/9000000000000004/');
 result:=public.studio_posting_queue();
 select value into packet from jsonb_array_elements(result) where value->>'id'=copy_id::text;
 if packet->>'state'<>'submitted' then raise exception 'FAIL: submitted was called live without evidence'; end if;
 execute 'reset role';
 update public.active_listings set status='sold',is_active=false where id=source_id;
 if (select state from studio_core.posting_copies where id=copy_id)<>'remove_needed' then raise exception 'FAIL: source sale did not flag destination'; end if;
 execute 'set local role anon';
 begin perform public.studio_posting_inventory();raise exception 'FAIL: anonymous inventory access';exception when insufficient_privilege then null;end;
 execute 'reset role';
 raise notice 'PASS: facts, account gate, claims, token replay, publication evidence, sold trigger, and anonymous isolation';
end $$;
rollback;
