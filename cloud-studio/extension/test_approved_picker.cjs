const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/approved_picker_worker.js','utf8');
function fixture(){
 const listeners=[],session={},calls=[];
 const c={console,studioFillBusy:new Set(),studioMemberFetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>'a'.repeat(64)}},studioFillApprovedTab:async tab=>{calls.push({filled:tab});return {ok:true,photo_count:2}},chrome:{runtime:{id:'extension',getURL:()=> 'chrome-extension://extension/',onMessage:{addListener:fn=>listeners.push(fn)}},tabs:{get:async()=>({url:'https://www.facebook.com/marketplace/create/item'})},scripting:{executeScript:async()=>[{result:true}]},storage:{session:{get:async key=>({[key]:session[key]}),set:async values=>Object.assign(session,values)}}}};
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
  const trace=[];c.studioCloudNext=async()=>({source:'studio',item:{id:'one',title:'Used speaker',price:125,description:'Cracked glass.',condition:'Used - Fair',imageBlobs:[{dataUrl:'data:image/jpeg;base64,fixture'}]}});c.moeFillExplicitListing=()=>{};
  c.chrome.scripting.executeScript=async()=>[{result:{ok:true}}];c.studioAssertBlank=async()=>trace.push('blank');c.waitFacebookFields=async()=>trace.push('fields');c.waitFacebookCondition=async()=>trace.push('condition');c.stageStudioPhotos=async()=>[{path:'staged.jpg',id:1}];c.setNativeFacebookPhotos=async()=>trace.push('attached');c.waitFacebookPhotoCount=async()=>{if(fail)throw Error('Photo count mismatch');trace.push('count')};c.scheduleStagedPhotoCleanup=async()=>trace.push('scheduled');c.removeStagedPhotos=async()=>trace.push('removed');
  if(fail){await assert.rejects(vm.runInContext('studioFillApprovedTab(7)',c),/Photo count/);assert.ok(trace.includes('removed'))}else{assert.equal((await vm.runInContext('studioFillApprovedTab(7)',c)).photo_count,1);assert.deepEqual(trace,['blank','fields','condition','attached','count','scheduled']);}
 }
});
