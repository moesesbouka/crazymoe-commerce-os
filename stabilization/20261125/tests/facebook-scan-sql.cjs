const {PGlite} = require(process.env.STUDIO_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const db = new PGlite();
const path = require('node:path');
const repo = path.resolve(__dirname,'../../..');
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const run = '00000000-0000-0000-0000-000000000011';
const payload = JSON.stringify([
  {facebook_id:'1000000001',account_tag:'crazymoe',title:'Upstream title',is_active:false},
  {facebook_id:'1000000011',account_tag:'crazymoe',title:'New observation'}
]);
const row = async (query, arguments_) => (await db.query(query, arguments_)).rows[0]?.value;
(async () => {
  await db.exec(`
    create schema auth; create schema studio_core;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key);
    create table studio_core.members(user_id uuid primary key, enabled boolean, role text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function studio_core.is_member() returns boolean language sql stable as $$
      select exists (select 1 from studio_core.members where user_id=auth.uid() and enabled) $$;
    create table public.active_listings(id bigint primary key, account_tag text, facebook_id text,
      title text, price numeric, last_seen_at timestamptz,status text,is_active boolean,quantity integer);
    create table public.public_listings(account_tag text,facebook_id text, price numeric,is_active boolean,
      is_published boolean,visibility_scope text,status text,updated_at timestamptz);
    create table studio_core.inventory(id text primary key,lifecycle text);
    create table studio_core.listing_authoring(inventory_id text,fields jsonb,status text);
    create table studio_core.physical_links(id uuid primary key,owner_id uuid,studio_id text,imported_id bigint,status text);
    create table studio_core.mercari_queue(id uuid primary key default gen_random_uuid(), owner_id uuid, source_kind text, source_id text,
      draft jsonb, state text, listing_url text, physical_link_id uuid, updated_at timestamptz default now(),
      source_digest text,source_snapshot jsonb,field_provenance jsonb,revision integer default 1, unique(owner_id,source_kind,source_id));
    create table studio_core.mercari_events(queue_id uuid,actor uuid,event text,revision integer,payload jsonb);
    create function studio_core.mercari_source(text,text) returns jsonb language sql as $$select jsonb_build_object(
      'available',true,'digest',$2,'physical_link',to_jsonb(l)-'owner_id') from studio_core.physical_links l
      where ($1='imported' and l.imported_id::text=$2) or ($1='studio' and l.studio_id=$2) order by l.id limit 1$$;
    create function studio_core.mercari_validate(jsonb,jsonb) returns void language sql as $$select$$;
    create function studio_core.mercari_readiness(jsonb,jsonb) returns jsonb language sql as $$select '{"ready":true}'::jsonb$$;
    create table studio_core.mercari_catalog_choices(owner_id uuid,source_kind text,source_id text,included boolean);
    create table studio_core.posting_accounts(id uuid primary key, owner_id uuid, account_tag text, label text, profile_id text);
    create table studio_core.posting_copies(owner_id uuid, source_id bigint, account_id uuid,
      listing_id text, draft jsonb, state text);
    insert into auth.users values ('${owner}'),('${other}');
    insert into studio_core.members values ('${owner}',true,'owner'),('${other}',true,'editor');
    insert into public.active_listings values
      (1,'crazymoe','1000000001','Bose Smart Soundbar 900',399,now()-interval '20 days','active',true,1),
      (2,'crazymoe','1000000002','Bose Smart Soundbar 900',359,now()-interval '30 days','inactive',false,1),
      (3,'second','1000000003','Same Title Test',10,now(),'active',true,1),
      (4,'crazymoe','1000000004','Same Title Test',12,now(),'active',true,1),
      (5,'second','1000000005','Linked amplifier',500,now(),'active',true,1);
    insert into studio_core.inventory values ('CM-1','current'),('CM-2','current');
    insert into studio_core.listing_authoring values
      ('CM-1','{"title":"Linked amplifier","price":"500"}','listed'),
      ('CM-2','{"title":"Possible match","price":"399"}','review');
    insert into studio_core.physical_links values
      ('00000000-0000-0000-0000-000000000031','${owner}','CM-1',5,'confirmed'),
      ('00000000-0000-0000-0000-000000000032','${owner}','CM-2',1,'candidate');
    insert into public.public_listings values ('second','1000000005',499,true,true,'public','active',now());
    insert into studio_core.mercari_queue (id,owner_id,source_kind,source_id,draft,state,listing_url,physical_link_id,updated_at) values
      ('00000000-0000-0000-0000-000000000021','${owner}','imported','5','{"price":"550"}','needs_details',null,null,now());
    insert into studio_core.mercari_catalog_choices values ('${owner}','imported','5',true);
    select set_config('request.jwt.claim.sub','${owner}',false);
  `);
  await db.exec(fs.readFileSync(repo+'/cloud-studio/migrations/observed_listings.sql','utf8'));
  await db.exec(fs.readFileSync(repo+'/stabilization/20261125/studio_channels.sql','utf8'));
  await db.exec("create unique index physical_links_confirmed_studio on studio_core.physical_links(owner_id,studio_id) where status='confirmed'");
  await db.exec(fs.readFileSync(repo+'/supabase/migrations/20261125201304_studio_facebook_scan_hardening.sql','utf8'));
  let value = await row("select public.studio_channel_inventory() as value");
  assert.deepEqual(value.accounts.map(account => account.account_tag),['crazymoe','second']);
  const bose = value.items.find(item => item.source_id === '1');
  assert.equal(bose.related[0].price,359);
  assert.equal(bose.related[0].active,false);
  assert(!value.items.some(item => item.source_id === '2'));
  const linked = value.items.find(item => item.source_id === 'CM-1');
  assert.equal(linked.facebook[0].account_tag,'second');
  assert.equal(linked.mercari.price,'550');
  assert.equal(linked.website.price,499);
  assert.equal((await row("select public.studio_channel_inventory('mercari') as value")).total,1);
  assert.equal((await row("select public.studio_channel_inventory('duplicates') as value")).total,3);
  assert.equal((await row("select public.studio_channel_inventory('stale') as value")).total,1);
  assert.equal(await row("select has_function_privilege('anon','public.studio_channel_inventory(text,text,integer,integer)','execute') as value"),false);
  const profile = '1700000001';
  const start = (id, account = 'crazymoe', viewer = profile) => row(
    "select public.studio_facebook_import_v2('start',$1,p_account=>$2,p_mode=>'full',p_profile=>$3,p_version=>'66.0.13') as value",
    [id,account,viewer]);
  const action = (name, id, extra = '', args = []) => row(
    "select public.studio_facebook_import_v2($1,$2,p_profile=>$3"+extra+") as value",[name,id,profile,...args]);
  const finish = (id, found, reason, pages = 1) => action('saving',id,',p_found=>$4,p_pages=>$5,p_end_reason=>$6',[found,pages,reason]);
  const batch = (id, number, rows) => action('batch',id,',p_batch=>$4,p_rows=>$5',[number,rows]);
  const nextId = n => '00000000-0000-0000-0000-'+String(n).padStart(12,'0');

  await assert.rejects(start(run),/FACEBOOK_ACCOUNT_MISMATCH/);
  await row("select public.studio_register_facebook_scan_account('crazymoe',$1) as value",[profile]);
  await assert.rejects(start(run,'crazymoe','1900000001'),/FACEBOOK_ACCOUNT_MISMATCH/);
  await assert.rejects(start(run,'random_tag'),/FACEBOOK_ACCOUNT_MISMATCH/);
  await assert.rejects(row("select public.studio_facebook_import('start',$1) as value",[run]),/SCANNER_UPDATE_REQUIRED/);
  assert.equal(await row("select has_function_privilege('authenticated','public.studio_sync_observations(text,text,jsonb)','execute') as value"),false);
  await row("select set_config('request.jwt.claim.sub',$1,false) as value",[other]);
  await assert.rejects(start(run),/FACEBOOK_ACCOUNT_MISMATCH/);
  await assert.rejects(row("select public.studio_register_facebook_scan_account('other',$1) as value",[profile]),/owner access/);
  await row("select set_config('request.jwt.claim.sub',$1,false) as value",[owner]);

  assert.equal((await start(run,null)).account_tag,'crazymoe');
  assert.equal((await start(run,null)).state,'discovering');
  await assert.rejects(start(nextId(40)),/facebook_import_one_running/);
  await assert.rejects(finish(run,0,'end_of_feed'),/Invalid catalog coverage/);
  await assert.rejects(finish(run,1,null),/Invalid catalog coverage/);
  await assert.rejects(finish(run,1,'page_cap',299),/Invalid catalog coverage/);
  await assert.rejects(action('complete',run),/unverified coverage/);
  assert.equal((await finish(run,2,'end_of_feed')).state,'saving');
  assert.equal((await finish(run,2,'end_of_feed')).state,'saving');
  assert.equal((await batch(run,0,payload)).pending,1);
  assert.equal((await batch(run,0,payload)).processed,2);
  await assert.rejects(batch(run,0,JSON.stringify([JSON.parse(payload)[0]])),/different payload/);
  assert.equal((await batch(run,1,payload)).processed,2);
  assert.equal((await action('complete',run)).state,'completed');
  assert.equal((await action('complete',run)).state,'completed');

  const missingBefore=await row("select last_seen_at::text as value from public.active_listings where id=4");
  const limited=nextId(41);
  await start(limited);
  await finish(limited,2,'page_cap',300);
  const repeat = await batch(limited,0,payload);
  assert.deepEqual([repeat.processed,repeat.refreshed,repeat.pending,repeat.skipped],[2,1,0,1]);
  assert.equal((await action('complete',limited)).state,'partial');
  assert.equal(await row("select price::text as value from public.active_listings where id=1"),'399');
  assert.equal(await row("select is_active as value from public.active_listings where id=2"),false);
  assert.equal(await row("select last_seen_at::text as value from public.active_listings where id=4"),missingBefore);
  assert.equal(await row("select is_active as value from public.active_listings where id=4"),true);

  const empty=nextId(42);
  await start(empty);
  await finish(empty,0,'verified_empty');
  assert.equal((await action('complete',empty)).end_reason,'verified_empty');

  const expired = nextId(43);
  await start(expired);
  await db.query("update studio_core.facebook_import_runs set progress_at=now()-interval '3 minutes' where id=$1",[expired]);
  assert((await row("select public.studio_facebook_import_status() as value")).some(r=>r.id===expired&&r.state==='interrupted'));
  assert.equal((await action('heartbeat',expired,',p_pages=>25')).state,'interrupted');
  assert.equal((await action('batch',expired)).state,'interrupted');
  assert.equal(await row("select state as value from studio_core.facebook_import_runs where id=$1",[expired]),'interrupted');

  const stop = nextId(44);
  await start(stop);
  await finish(stop,2,'end_of_feed');
  const one = JSON.stringify([JSON.parse(payload)[0]]);
  await batch(stop,0,one);
  assert.equal((await action('stop',stop)).state,'stopped');
  assert.equal((await batch(stop,1,payload)).processed,1);

  await db.exec(`
    insert into studio_core.posting_accounts values ('${nextId(61)}','${owner}','second','Second account','1700000002');
    insert into studio_core.posting_copies values ('${owner}',4,'${nextId(61)}','1000000020','{"price":"12"}','live');
  `);
  await row("select public.studio_register_facebook_scan_account('second','1700000002') as value");
  await assert.rejects(start(nextId(62),'second',profile),/FACEBOOK_ACCOUNT_MISMATCH/);
  let grid = (await row("select public.studio_channel_inventory() as value")).items;
  assert.deepEqual(grid.find(item=>item.source_id==='4').facebook.map(f=>f.state),['active','posted']);
  await db.exec("insert into public.active_listings values (6,'second','1000000020','Different cross-post title','12',now(),'active',true,1)");
  grid=(await row("select public.studio_channel_inventory() as value")).items;
  assert.deepEqual(grid.find(item=>item.source_id==='4').facebook.map(f=>[f.account_tag,f.state]),[['crazymoe','active'],['second','active']]);
  assert(!grid.some(item=>item.source_id==='6'));
  await db.exec("update public.active_listings set is_active=false,status='sold' where id=6");
  grid=(await row("select public.studio_channel_inventory() as value")).items;
  assert.equal(grid.find(item=>item.source_id==='4').facebook.find(f=>f.account_tag==='second').state,'sold');

  await db.exec(`insert into studio_core.physical_links values
    ('${nextId(63)}','${owner}','CM-1',4,'confirmed','ignored-client-value')`);
  assert.equal(await row("select account_tag as value from studio_core.physical_links where id=$1",[nextId(63)]),'crazymoe');
  await assert.rejects(db.exec(`insert into studio_core.physical_links values
    ('${nextId(64)}','${owner}','CM-1',1,'confirmed','wrong')`),/physical_links_confirmed_studio_account/);
  const queueLink = await row("select studio_core.mercari_prepare($1) as value",
    [JSON.stringify([{source_kind:'imported',source_id:'4',digest:'4',draft:{price:'700'}}])]);
  assert.equal(queueLink[0].id,nextId(21));
  assert.equal(await row("select draft->>'price' as value from studio_core.mercari_queue where id=$1",[nextId(21)]),'550');
  assert.equal(await row("select count(*) as value from studio_core.mercari_queue"),1);
  console.log('Facebook scan SQL integration: binding, coverage, leases, idempotency, counts, Stop, cross-posts and Mercari continuity passed.');
})().catch(error => { console.error(error.message,error.detail,error.where); process.exitCode=1; }).finally(()=>db.close());
