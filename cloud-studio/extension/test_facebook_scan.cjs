const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const profile = "1700000001";
const source = name => fs.readFileSync(__dirname + "/" + name, "utf8");
const moduleContext = (name, extra = {}) => {
  const context = {AbortController, AbortSignal, URL, Error, ...extra};
  vm.runInNewContext(source(name), context, {filename: name});
  return context;
};
const page = (ids, hasNext, cursor) => JSON.stringify({data: {viewer: {
  marketplace_listing_sets: {edges: ids.map(id => ({node: {id}})), page_info: {has_next_page: hasNext, end_cursor: cursor}}
}}});

function discovery(...pages) {
  const scanner = moduleContext("facebook_scan_discovery.js");
  const signals = [];
  const config = {
    profile, getProfile: () => profile,
    signal: new AbortController().signal,
    fetchPage: async cursor => { signals.push(cursor); return pages.shift(); },
    extract: node => ({facebook_id: node.id}),
    report() {}, pause: async () => {}
  };
  return {run: options => scanner.discoverFacebookListings({...config, ...options}), signals};
}

test("a true terminal page, including a separately verified empty catalog, carries coverage", async () => {
  const a = discovery(page(["1000000001"],true,"next"), page(["1000000002"],false,null));
  const found = await a.run();
  assert.equal(found.endReason,"end_of_feed");
  assert.equal(found.pages,2);
  assert.equal(found.listings.length,2);
  assert.deepEqual(a.signals,[null,"next"]);
  const empty = await discovery(page([],false,null)).run();
  assert.equal(empty.endReason,"verified_empty");
  assert.equal(empty.listings.length,0);
});

test("a cap is partial, and an HTTP 200 with unrelated or unreadable contents fails", async () => {
  const capped = discovery(...Array.from({length:300},(_,i) => page([String(1000000001+i)],true,"next-"+i)));
  assert.equal((await capped.run()).endReason,"page_cap");
  for (const body of ["<html>Sign in</html>",'{"errors":[{"message":"request failed"}]}',
    '{"data":{"random":{"edges":[],"page_info":{"has_next_page":false}}}}']) {
    await assert.rejects(discovery(page(["1000000001"],true,"next"),body).run(),{code:"FACEBOOK_RESPONSE"});
  }
  await assert.rejects(discovery(page(["1000000001"],true,"next"),page(["1000000001"],true,"next")).run(),{code:"FACEBOOK_CURSOR"});
});

test("only the current Facebook viewer is used, and a profile switch during the request fails", async () => {
  const document = {scripts: [{textContent:'{"sellerID":"1900000001"}'}, {textContent:'["CurrentUserInitialData",[],{"USER_ID":"1700000001"}]'}]};
  const scanner = moduleContext("facebook_scan_discovery.js",{document});
  assert.equal(scanner.facebookSellingProfile(),profile);
  document.scripts.push({textContent:'["CurrentUserInitialData",[],{"USER_ID":"1900000001", "NAME":"Other viewer"}]'});
  assert.throws(()=>scanner.facebookSellingProfile(),{code:"FACEBOOK_IDENTITY"});
  let calls=0;
  await assert.rejects(discovery(page(["1000000001"],false,null)).run({
    getProfile:()=>calls++===0?profile:"1900000001"
  }),{code:"FACEBOOK_IDENTITY"});
});

test("timeout aborts a hung Facebook fetch", async () => {
  const scanner = moduleContext("facebook_scan_discovery.js");
  let timer;
  try {
    timer = setTimeout(()=>{},1000);
    await assert.rejects(scanner.readFacebookScanResponse(signal => new Promise((resolve,reject)=>{
      signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
    }),new AbortController().signal,10),{code:"FACEBOOK_TIMEOUT"});
  } finally { clearTimeout(timer); }
});

test("an expired worker token refreshes once and reaches the authenticated scan RPC", async () => {
  let listener;
  let stored = {token:"expired", expires:1, refresh:"fixture-refresh"};
  const calls = [];
  moduleContext("facebook_scan_worker.js",{
    chrome:{
      runtime:{onMessage:{addListener:fn=>{listener=fn;}},getManifest:()=>({version:"66.0.13"})},
      storage:{session:{get:async()=>({studioSync:stored}),set:async value=>{stored=value.studioSync;}}},
      tabs:{}
    },
    fetch:async(url,request)=>{
      calls.push({url,authorization:request.headers.Authorization});
      return {ok:true,json:async()=>url.includes("/auth/")?{
        access_token:"renewed",refresh_token:"rotated",expires_at:Date.now()/1000+3600
      }:{state:"discovering"}};
    }
  });
  const reply = action => new Promise(resolve=>listener({type:"STUDIO_FACEBOOK_SCAN_V2",action,profile},
    {url:"https://www.facebook.com/marketplace/you/selling/",frameId:0},resolve));
  assert((await Promise.all([reply("start"),reply("heartbeat")])).every(result=>result.ok));
  assert.equal(calls.filter(call=>call.url.includes("/auth/")).length,1);
  assert(calls.filter(call=>call.url.includes("/rest/")).every(call=>call.authorization==="Bearer renewed"));
  assert.equal(stored.refresh,"rotated");
});

test("Stop from Studio aborts discovery and a partial scan remains partial after the last batch", async () => {
  let heartbeat;
  let stopped = false;
  const messages = [];
  const scanner = moduleContext("facebook_scan_progress.js",{
    chrome:{runtime:{sendMessage:async message=>{
      messages.push(message);
      if (message.action==="start") return {ok:true,state:"discovering",account_tag:"crazymoe"};
      if (message.action==="heartbeat") return {ok:true,state:stopped?"stopped":"discovering"};
      if (message.action==="complete") return {ok:true,state:"partial",end_reason:"page_cap"};
      return {ok:true,state:"saving",processed:1};
    }}},
    crypto:{randomUUID:()=>"fixture"},
    setInterval:fn=>{heartbeat=fn;return 1;}, clearInterval:()=>{},
    facebookSellingProfile:()=>profile
  });
  const run = await scanner.startHardenedFacebookScan("full",profile);
  const result=await run.save({listings:[{facebook_id:"1000000001"}],pages:300,endReason:"page_cap"},()=>{});
  assert.equal(result.state,"partial");
  assert.equal(messages.find(m=>m.action==="saving").endReason,"page_cap");
  assert(messages.every(m=>m.profile===profile));
  const next=await scanner.startHardenedFacebookScan("full",profile);
  stopped=true;
  await heartbeat();
  assert(next.signal.aborted);
  await assert.rejects(next.save({listings:[]},()=>{}),/stopped in Studio/);
});
