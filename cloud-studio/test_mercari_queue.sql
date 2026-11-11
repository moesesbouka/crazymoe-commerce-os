-- Run against the deployed schema; every fixture and event is rolled back.
begin;
do $$
declare owner uuid; other uuid:=gen_random_uuid(); src jsonb; d jsonb; result jsonb; q jsonb; item uuid; rev integer;
begin
 select user_id into strict owner from studio_core.members where enabled order by user_id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 insert into studio_core.inventory(id) values('mercari-transaction-test');
 insert into studio_core.listing_authoring(inventory_id,fields) values('mercari-transaction-test','{"title":"Test speaker","description":"Test item, scratched cabinet.","price":"100","condition":"New"}');
 insert into studio_core.product_identity(inventory_id,verification_status,identity) values('mercari-transaction-test','verified_exact','{"brand":"Test"}');
 insert into studio_core.photo_assets(sha256,object_path,bytes,cloud_verified_at) values(repeat('e',64),'mercari-test-transaction-only',5,now());
 insert into studio_core.photo_selection(inventory_id,selection) values('mercari-transaction-test',jsonb_build_array(jsonb_build_object('sha',repeat('e',64),'kind','real','name','test.jpg'),jsonb_build_object('kind','manufacturer','id','factory')));
 src:=studio_core.mercari_source('studio','mercari-transaction-test');
 if jsonb_array_length(src->'photos')<>1 then raise exception 'Factory photo was not excluded'; end if;
 d:=jsonb_build_object('title','Test speaker','description','Scratched cabinet.','price','100','condition','New','category','Electronics / Audio','brand','Test',
  'shipping',jsonb_build_object('payer','buyer','weight_oz','32','length_in','10','width_in','8','height_in','8'),'photos',src->'photos','photos_confirmed',true);
 result:=public.studio_mercari_prepare(jsonb_build_array(jsonb_build_object('source_kind','studio','source_id','mercari-transaction-test','digest',src->>'digest','draft',d)));
 item:=(result->0->>'id')::uuid;
 result:=public.studio_mercari_prepare(jsonb_build_array(jsonb_build_object('source_kind','studio','source_id','mercari-transaction-test','digest',src->>'digest','draft',d)));
 if (result->0->>'created')::boolean then raise exception 'Duplicate preparation created a second item'; end if;
 q:=public.studio_mercari_update(item,1,'download');
 if q->>'state'<>'ready' then raise exception 'Complete listing is not ready'; end if;
 begin
  perform public.studio_mercari_update(item,1,'save',jsonb_set(d,'{photos}',jsonb_build_array(jsonb_build_object('url','https://evil.example/x.jpg'))));
  raise exception 'FAIL: foreign photo accepted';
 exception when raise_exception then if sqlerrm='FAIL: foreign photo accepted' then raise; end if; end;
 q:=public.studio_mercari_update(item,1,'save',jsonb_set(d,'{title}','"Updated speaker"'));
 if (q->>'revision')::integer<>2 then raise exception 'Revision did not advance'; end if;
 begin perform public.studio_mercari_update(item,1,'save',d); raise exception 'FAIL: stale revision accepted';
 exception when serialization_failure then null; end;
 update studio_core.listing_authoring set revision=revision+1 where inventory_id='mercari-transaction-test';
 begin perform public.studio_mercari_update(item,2,'download'); raise exception 'FAIL: changed source accepted';
 exception when serialization_failure then null; end;
 q:=public.studio_mercari_update(item,2,'rebuild',d);
 begin perform public.studio_mercari_update(item,3,'posted',null,'https://mercari.com.evil.example/us/item/m123/'); raise exception 'FAIL: foreign link accepted';
 exception when raise_exception then if sqlerrm='FAIL: foreign link accepted' then raise; end if; end;
 q:=public.studio_mercari_update(item,3,'posted',null,'https://mercari.com/us/item/m999999999999/?test=true');
 if q->>'listing_url'<>'https://www.mercari.com/us/item/m999999999999/' then raise exception 'Link not normalized'; end if;
 begin perform public.studio_mercari_update(item,4,'save',d); raise exception 'FAIL: posted item editable';
 exception when raise_exception then if sqlerrm='FAIL: posted item editable' then raise; end if; end;
 perform public.studio_mercari_update(item,4,'sold');
 perform public.studio_mercari_preset('Transaction-only test',d->'shipping');
 begin perform public.studio_mercari_preset('Bad preset','{"payer":"buyer","weight_oz":"0"}'); raise exception 'FAIL: invalid shipping preset accepted';
 exception when raise_exception then if sqlerrm='FAIL: invalid shipping preset accepted' then raise; end if; end;
 insert into auth.users(id) values(other);
 insert into studio_core.members(user_id,role) values(other,'editor');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
 if public.studio_mercari_state()->'queue'<>'[]'::jsonb or public.studio_mercari_state()->'presets'<>'[]'::jsonb then raise exception 'Other member can see owner queue'; end if;
 begin perform public.studio_mercari_update(item,5,'sold'); raise exception 'FAIL: other member updated owner queue'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 begin perform public.studio_mercari_state(); raise exception 'FAIL: nonmember read queue'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.studio_mercari_state()','execute') or has_table_privilege('authenticated','studio_core.mercari_queue','select')
 or has_function_privilege('authenticated','studio_core.mercari_source(text,text)','execute') then raise exception 'Overbroad client privileges'; end if;
end $$;
do $$
declare owner uuid; item uuid; q jsonb; result jsonb;
begin
 select owner_id into owner from studio_core.mercari_queue where source_id='mercari-transaction-test';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 result:=public.studio_mercari_categories('[["Electronics","Home Audio","Home Speakers"]]');
 result:=public.studio_mercari_categories('[["Electronics","Home Audio","Home Speakers"],["Home","Furniture"]]');
 if not (result->'paths') @> '[["Electronics","Home Audio","Home Speakers"],["Home","Furniture"]]'::jsonb then raise exception 'Category merge failed';end if;
 select id into item from studio_core.mercari_queue where owner_id=owner and source_id='mercari-transaction-test';
 update studio_core.mercari_queue set state='needs_details' where id=item;
 select to_jsonb(t) into q from studio_core.mercari_queue t where id=item;
 begin perform public.studio_mercari_handoff(item,null,'filled','{}');raise exception 'FAIL: null revision accepted';exception when serialization_failure then null;end;
 perform public.studio_mercari_handoff(item,(q->>'revision')::integer,'filled','{"done":["Title","Photos"]}');
 result:=public.studio_mercari_handoff(item,(q->>'revision')::integer,'published','{"url":"https://www.mercari.com/us/item/m777777777777/"}');
 if result->>'state'<>'posted' then raise exception 'Browser publication confirmation failed';end if;
 if has_function_privilege('anon','public.studio_mercari_categories(jsonb)','execute') or has_table_privilege('authenticated','studio_core.mercari_taxonomy','select') then raise exception 'Categories exposed to unauthorized roles';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$begin
 begin perform public.studio_mercari_state(); raise exception 'FAIL: unauthorized role read'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: prepare, deduplicate, photos, revisions, source changes, posted links, shipping presets, owner isolation and role grants' as result;
rollback;
