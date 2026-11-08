const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/approved_picker_worker.js','utf8');
function fixture(){
 const listeners=[],session={},calls=[];
 const c={console,studioFillBusy:new Set(),studioMemberFetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>'a'.repeat(64)}},studioFillApprovedTab:async tab=>{calls.push({filled:tab});return {ok:true,photo_count:2}},chrome:{runtime:{id:'extension',getURL:()=> 'chrome-extension://extension/',onMessage:{addListener:fn=>listeners.push(fn)}},tabs:{onRemoved:{addListener:()=>{}},get:async()=>({url:'https://www.facebook.com/marketplace/create/item'})},scripting:{executeScript:async()=>[{result:true}]},storage:{session:{get:async key=>key===null?{...session}:({[key]:session[key]}),set:async values=>Object.assign(session,values),remove:async key=>delete session[key]}}}};
 vm.createContext(c);vm.runInContext(source,c);return {c,calls,session,listeners,run:js=>vm.runInContext(js,c)};
}
test('approved list contains all nine active approvals and no private notes',()=>{
 const f=fixture();f.c.state=Array.from({length:9},(_,i)=>({id:'id'+i,revision:i+1,status:'approved',lifecycle:'active',fields:{title:'Item '+i,price:125,condition:'Used',notes:'PRIVATE'},photo_selection:[{},{}]})).concat([{id:'draft',status:'review'},{id:'archived',status:'approved',lifecycle:'archived'}]);
 const rows=f.run('studioApprovedRows(state)');assert.equal(rows.length,9);assert.equal(rows[0].photo_count,2);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});
test('only own popup and top-level Facebook item form can request approved products',()=>{
 const f=fixture();f.c.sender={id:'extension',frameId:0,tab:{id:7},url:'https://www.facebook.com/marketplace/create/item'};assert.equal(f.run('studioPickerSender(sender)'),true);
 for(const patch of [{id:'other'},{frameId:1},{url:'https://www.facebook.com/messages'},{url:'https://evil.test/marketplace/create/item'}]){f.c.bad={...f.c.sender,...patch};assert.equal(f.run('studioPickerSender(bad,true)'),false)}
 f.c.popup={id:'extension',url:'chrome-extension://extension/popup.html'};assert.equal(f.run('studioPickerSender(popup,true)'),true);assert.equal(f.run('studioPickerSender(popup,false)'),false);
});
test('chosen ID/revision issues a fresh handoff then reuses verified photo filler',async()=>{
 const f=fixture();assert.equal((await f.run("studioPickerSelect(7,'product_one',3)")).ok,true);
 assert.deepEqual(JSON.parse(f.calls[0].options.body),{p_item:'product_one',p_revision:3});assert.equal(f.session.studioDraft7,'a'.repeat(64));assert.equal(f.calls[1].filled,7);
});
test('an existing typed draft prevents token creation and filling',async()=>{
 const f=fixture();f.c.chrome.scripting.executeScript=async()=>[{result:false}];await assert.rejects(f.run("studioPickerSelect(7,'item',1)"),/already contains/);assert.equal(f.calls.length,0);
});
test('a draft typed during the handoff request is preserved',async()=>{
 const f=fixture();let reads=0;f.c.chrome.scripting.executeScript=async()=>[{result:++reads===1}];await assert.rejects(f.run("studioPickerSelect(7,'item',1)"),/already contains/);assert.equal(f.calls.length,1);assert.equal(f.session.studioDraft7,undefined);
});
test('stale approval response cannot fill or store a handoff',async()=>{
 const f=fixture();f.c.studioMemberFetch=async()=>({ok:false,json:async()=>({message:'Listing changed since approval'})});await assert.rejects(f.run("studioPickerSelect(7,'item',1)"),/changed since approval/);assert.equal(f.calls.length,0);assert.equal(f.session.studioDraft7,undefined);
});
test('existing assigned Studio draft cannot be replaced by a picker choice',async()=>{
 const f=fixture();f.session.studioDraft7='existing';await assert.rejects(f.run("studioPickerSelect(7,'item',1)"),/already has a Studio draft/);assert.equal(f.session.studioDraft7,'existing');assert.equal(f.calls.length,0);
});
test('double clicks produce one handoff and one fill',async()=>{
 const f=fixture();const first=f.run("studioPickerSelect(7,'item',1)");await assert.rejects(f.run("studioPickerSelect(7,'second',1)"),/already loading/);await first;assert.equal(f.calls.length,2);
});
test('native fill verifies fields, condition and photo count; cleans up on failure',async()=>{
 for(const fail of [false,true]){
  const f=fixture();f.c.importScripts=()=>{};f.c.chrome.alarms={onAlarm:{addListener:()=>{}}};f.c.chrome.runtime.onMessageExternal={addListener:()=>{}};f.c.studioOrigins=new Set();
  // Separate scope supplies the real existing native-fill implementation.
  const c={...f.c};delete c.studioFillBusy;delete c.studioFillApprovedTab;vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/ngk_cloud_worker.js','utf8'),c);
  const trace=[];c.studioSaveContext=async(id,value)=>{c.savedContext=value;};c.studioCloudNext=async()=>({source:'studio',item:{id:'one',revision:3,title:'Used speaker',price:125,description:'Cracked glass.',condition:'Used - Fair',imageBlobs:[{dataUrl:'data:image/jpeg;base64,fixture'}]}});c.moeFillExplicitListing=()=>{};
  c.chrome.scripting.executeScript=async()=>[{result:{ok:true}}];c.studioAssertBlank=async()=>trace.push('blank');c.waitFacebookFields=async()=>trace.push('fields');c.waitFacebookCondition=async()=>trace.push('condition');c.stageStudioPhotos=async()=>[{path:'staged.jpg',id:1}];c.setNativeFacebookPhotos=async()=>trace.push('attached');c.waitFacebookPhotoCount=async()=>{if(fail)throw Error('Photo count mismatch');trace.push('count')};c.scheduleStagedPhotoCleanup=async()=>trace.push('scheduled');c.removeStagedPhotos=async()=>trace.push('removed');
  if(fail){await assert.rejects(vm.runInContext('studioFillApprovedTab(7)',c),/Photo count/);assert.ok(trace.includes('removed'));assert.equal(c.savedContext.phase,'error')}else{assert.equal((await vm.runInContext('studioFillApprovedTab(7)',c)).photo_count,1);assert.deepEqual(trace,['blank','fields','condition','attached','count','scheduled']);assert.equal(c.savedContext.phase,'loaded');assert.equal(c.savedContext.revision,3);}
 }
});

function loopFixture(){
 const f=fixture();let created=20;
 f.c.sleepCloud=async()=>{};
 f.c.chrome.tabs.create=async values=>{f.calls.push({created:values});return {id:++created}};
 f.c.chrome.tabs.update=async(id,values)=>{f.calls.push({updated:id,values});return {id}};
 f.c.chrome.tabs.get=async id=>({id,status:'complete',url:'https://www.facebook.com/marketplace/create/item/'});
 f.c.studioAutoFill=async(id,item)=>{f.calls.push({autoFill:id,item});};
 f.c.rows=[{id:'next',revision:4,status:'approved',fields:{title:'Next product'},lifecycle:'active'}];
 f.c.studioMemberFetch=async(url,options)=>{f.calls.push({url,options});return {ok:true,json:async()=>url.endsWith('studio_state')?f.c.rows:{ok:true}}};
 f.session.studioApprovedContext7={id:'current',revision:3,title:'Current product',phase:'loaded',photo_count:2};
 return f;
}
test('seller confirmation saves before next form opens and auto loads exact next approval',async()=>{
 const f=loopFixture();const r=await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");
 assert.equal(r.nextTabId,21);assert.equal(f.session.studioApprovedContext7.phase,'confirmed');
 assert.deepEqual(JSON.parse(f.calls[0].options.body),{p_item:'current',p_revision:3,p_confirmed:true});
 assert.equal(f.calls[0].url,'/rest/v1/rpc/studio_confirm_published');
 assert.equal(f.calls.filter(x=>x.created).length,1);assert.equal(f.calls.find(x=>x.autoFill).item.id,'next');
 await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");
 assert.equal(f.calls.filter(x=>x.created).length,1);assert.equal(f.calls.filter(x=>x.url?.endsWith('studio_confirm_published')).length,1);
});
test('confirmation failure or changed revision never opens another tab',async()=>{
 const f=loopFixture();f.c.studioMemberFetch=async()=>({ok:false,json:async()=>({message:'Listing changed; refresh before confirming'})});
 await assert.rejects(f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})"),/Listing changed/);
 assert.equal(f.session.studioApprovedContext7.phase,'loaded');assert.equal(f.calls.length,0);
});
test('double confirmation clicks save and advance only once',async()=>{
 const f=loopFixture();const first=f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");
 await assert.rejects(f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})"),/already being opened/);await first;
 assert.equal(f.calls.filter(x=>x.created).length,1);
});
test('last approved product finishes without opening an empty tab',async()=>{
 const f=loopFixture();f.c.rows=[];const r=await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");
 assert.equal(r.done,true);assert.equal(f.session.studioApprovedContext7.done,true);assert.equal(f.calls.filter(x=>x.created).length,0);
});
test('Already listed binds selection to current server approval and advances',async()=>{
 const f=loopFixture();delete f.session.studioApprovedContext7;
 f.c.studioMemberFetch=async(url,options)=>{f.calls.push({url,options});if(url.endsWith('studio_confirm_published')){f.c.rows=[];return {ok:true,json:async()=>({ok:true})}}return {ok:true,json:async()=>f.c.rows}};
 const r=await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_ALREADY',id:'next',revision:4})");
 assert.equal(r.done,true);assert.equal(f.session.studioApprovedContext7.id,'next');assert.equal(f.session.studioApprovedContext7.phase,'confirmed');
 const other=loopFixture();delete other.session.studioApprovedContext7;
 await assert.rejects(other.run("studioAdvance(7,{type:'STUDIO_APPROVED_ALREADY',id:'next',revision:3})"),/approval changed/);
 assert.equal(other.calls.filter(x=>x.url?.endsWith('studio_confirm_published')).length,0);
});
test('failure opening next retains saved confirmation and retries without confirming again',async()=>{
 const f=loopFixture();f.c.chrome.tabs.create=async()=>{throw Error('Tab creation failed')};
 const r=await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");assert.equal(r.confirmed,true);assert.equal(r.ok,false);
 assert.equal(f.session.studioApprovedContext7.phase,'confirmed');
 f.c.chrome.tabs.create=async()=>({id:21});await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_NEXT'})");
 assert.equal(f.calls.filter(x=>x.url?.endsWith('studio_confirm_published')).length,1);
});
test('does not automatically duplicate an approved product already loaded in another tab',async()=>{
 const f=loopFixture();f.session.studioApprovedContext8={id:'next',phase:'loaded'};
 const r=await f.run("studioAdvance(7,{type:'STUDIO_APPROVED_CONFIRM'})");assert.equal(r.waiting,true);assert.equal(f.calls.filter(x=>x.created).length,0);
});
test('only tracked Marketplace tabs can confirm after leaving the form',async()=>{
 const f=loopFixture();const send=(message,sender)=>new Promise(resolve=>f.listeners[0](message,sender,resolve));
 const sender={id:'extension',frameId:0,tab:{id:7},url:'https://www.facebook.com/marketplace/you/selling'};
 assert.equal((await send({type:'STUDIO_APPROVED_CONTEXT'},sender)).context.id,'current');
 assert.equal((await send({type:'STUDIO_APPROVED_CONFIRM'},sender)).ok,true);
 assert.equal((await send({type:'STUDIO_APPROVED_CONFIRM'},{...sender,tab:{id:90}})).ok,false);
 assert.equal((await send({type:'STUDIO_APPROVED_CONFIRM'},{...sender,frameId:1})).ok,false);
 assert.equal((await send({type:'STUDIO_APPROVED_CONFIRM'},{...sender,id:'other'})).ok,false);
});
test('failed automatic fill preserves product identity for safe new-form retry',async()=>{
 const f=fixture();f.c.sleepCloud=async()=>{};f.c.chrome.tabs.get=async()=>({status:'complete',url:'https://www.facebook.com/marketplace/create/item/'});
 f.c.studioFillApprovedTab=async()=>{throw Error('Photos failed')};
 await f.run("studioAutoFill(7,{id:'next',revision:4,title:'Next product'})");
 assert.equal(f.session.studioApprovedContext7.phase,'error');assert.equal(f.session.studioApprovedContext7.id,'next');
});
