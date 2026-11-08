const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const fresh=()=>({access_token:'approved.session.token',refresh_token:'123456789012',expires_at:Date.now()/1000+3600});
function harness({tabs=[{id:1,url:'https://crazymoe-marketplace-studio.vercel.app/app/',status:'complete'}],signedIn=true,refreshStatus=200,missingBridge=false}={}){
 const store={},calls={refresh:0,opened:0,probes:0,api:0},listeners=[];
 const chrome={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener:f=>listeners.push(f)},onMessageExternal:{addListener(){} }},storage:{session:{get:async k=>k===null?store:{[k]:store[k]},set:async o=>Object.assign(store,o),remove:async k=>delete store[k]}},tabs:{query:async()=>tabs,create:async o=>{calls.opened++;return {id:2,...o};},get:async id=>({id,status:'complete',url:'https://crazymoe-marketplace-studio.vercel.app/app/'}),update:async()=>{},onRemoved:{addListener(){}},sendMessage:async id=>{calls.probes++;if(missingBridge&&id===1)throw Error('old tab');if(!signedIn)return {ok:false,needsSignIn:true};store.studioAuthSession=fresh();return {ok:true};}},scripting:{executeScript:async()=>[]}};
 const context=vm.createContext({chrome,URL,console,Date,Set,Uint8Array,setTimeout,clearTimeout,fetch:async(url)=>{
  if(String(url).includes('grant_type=refresh_token')){calls.refresh++;return {ok:refreshStatus===200,status:refreshStatus,json:async()=>fresh()};}
  calls.api++;return {ok:true,json:async()=>Array.from({length:10},(_,i)=>({id:'approved-'+i,status:'approved',lifecycle:'current',revision:1,fields:{title:'Product '+i,price:'55',condition:'New'},photo_selection:[{}]}))};
 }});
 vm.runInContext(fs.readFileSync(__dirname+'/cloud_handoff.js','utf8'),context);
 vm.runInContext(fs.readFileSync(__dirname+'/approved_picker_worker.js','utf8'),context);
 const run=code=>vm.runInContext(code,context);
 return {store,calls,chrome,run,listeners};
}
test('lost session reconnects and loads all ten approved products',async()=>{
 const h=harness();const rows=await h.run("(async()=>studioApprovedRows(await studioPickerRpc('studio_state')))()");assert.equal(rows.length,10);assert.equal(h.calls.opened,0);assert.equal(h.calls.probes,1);
});
test('restart with no Studio tab opens one signed-in tab for concurrent requests',async()=>{
 const h=harness({tabs:[]});const tokens=await h.run('Promise.all([studioMemberToken(),studioMemberToken(),studioMemberToken()])');assert.equal(tokens.length,3);assert.equal(h.calls.opened,1);assert.equal(h.calls.probes,1);
});
test('an editor with old code is preserved while a fresh connection tab opens',async()=>{
 const h=harness({missingBridge:true});await h.run('studioMemberToken()');assert.equal(h.calls.opened,1);assert.equal(h.calls.probes,2);
});
test('access token expired hours ago still refreshes once',async()=>{
 const h=harness();h.store.studioAuthSession={...fresh(),expires_at:Date.now()/1000-7200};await h.run('Promise.all([studioMemberToken(),studioMemberToken()])');assert.equal(h.calls.refresh,1);assert.equal(h.calls.opened,0);
});
test('revoked refresh token reconnects to the existing Studio session',async()=>{
 const h=harness({refreshStatus:401});h.store.studioAuthSession={...fresh(),expires_at:Date.now()/1000-7200};await h.run('studioMemberToken()');assert.equal(h.calls.refresh,1);assert.equal(h.calls.probes,1);
});
test('sign-in required is explicit; no API reads or empty-queue success',async()=>{
 const h=harness({signedIn:false});await assert.rejects(h.run("studioPickerRpc('studio_state')"),/Sign in to the Studio tab/);assert.equal(h.calls.api,0);assert.equal(h.calls.opened,0);
});
test('temporary auth failure preserves credentials without creating sign-in tabs',async()=>{
 const h=harness({refreshStatus:503});h.store.studioAuthSession={...fresh(),expires_at:Date.now()/1000-7200};await assert.rejects(h.run('studioMemberToken()'),/temporarily unavailable/);assert.ok(h.store.studioAuthSession);assert.equal(h.calls.opened,0);
});
test('Facebook content scripts cannot submit Studio credentials',()=>{
 const h=harness(),sender={id:'test-extension',frameId:0,tab:{id:3},url:'https://www.facebook.com/marketplace/create/item/'};
 assert.equal(h.listeners[0]({type:'STUDIO_AUTH_SESSION',session:fresh()},sender,()=>{}),false);assert.equal(h.store.studioAuthSession,undefined);
});
