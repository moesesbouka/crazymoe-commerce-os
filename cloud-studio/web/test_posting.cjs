const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const copy=require('./posting-copy.js');
const photo=copy.photoRoot+'listings/1234567890123/img_0.jpg';
const item={id:1,facebook_id:'1234567890123',account_tag:'crazymoe',title:'Bose 900 — Black',description:'USED. Glass top cracked.\n\nRemote included.\n\nPickup only.',condition:'Used - Fair',price:200,category:'Audio',images:[photo,photo.replace('0.jpg','1.jpg')],digest:'abc',copies:[]};
test('refresh preserves facts, exclusions, price, condition, and original photos',()=>{
 const before=JSON.stringify(item),d=copy.refreshCopy(item);
 for(const block of item.description.split('\n\n'))assert.ok(d.description.includes(block));
 assert.equal(d.price,200);assert.equal(d.condition,'Used - Fair');assert.deepEqual(d.images,item.images);
 assert.notEqual(d.description,item.description);assert.notEqual(d.title,item.title);assert.equal(JSON.stringify(item),before);
});
test('missing facts are not defaulted to New or a fabricated price',()=>{
 const broken={...item,condition:null,price:null,description:'',images:['https://example.com/private.jpg']};
 assert.deepEqual(copy.issues(broken),['Description missing','Condition missing','Price missing','Archived public photos missing']);
 assert.equal(copy.refreshCopy(broken).condition,null);assert.equal(copy.refreshCopy(broken).price,null);
});
test('profile parser rejects deceptive hosts and vanity names',()=>{
 assert.equal(copy.profileId('https://www.facebook.com/profile.php?id=1000123456789'),'1000123456789');
 assert.equal(copy.profileId('https://www.facebook.com.evil.test/profile.php?id=1000123456789'),'');
 assert.equal(copy.profileId('https://www.facebook.com/someone'),'');
});
function workerContext(scripts){
 const context={importScripts:()=>{},document:{querySelectorAll:()=>scripts.map(textContent=>({textContent}))},chrome:{runtime:{onMessageExternal:{addListener:()=>{}}}},studioOrigins:new Set(),console};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/account_queue_worker.js'),'utf8'),context);return context;
}
test('account gate uses only current user module and rejects ambiguity',()=>{
 const c=workerContext(['["CurrentUserInitialData",[],{"USER_ID":"1000123456789","NAME":"Seller"},270]','{"seller_id":"1999999999999"}']);
 assert.equal(vm.runInContext('accountCurrentSeller()',c),'1000123456789');
 const ambiguous=workerContext(['["CurrentUserInitialData",[],{"USER_ID":"1000123456789"},270]','[ "CurrentUserInitialData", [], {"USER_ID":"1999999999999"}, 270 ]']);
 assert.equal(vm.runInContext('accountCurrentSeller()',ambiguous),null);
 assert.equal(vm.runInContext('accountCurrentSeller()',workerContext(['{"USER_ID":"1999999999999"}'])),null);
});
test('wrong destination stops before any field fill',async()=>{
 const c=workerContext([]);c.chrome.tabs={get:async()=>({url:'https://www.facebook.com/marketplace/create/item'})};c.chrome.scripting={executeScript:async()=>[{result:'1000123456789'}]};
 await assert.rejects(vm.runInContext("accountAssertSeller(1,'1999999999999')",c),/Wrong Facebook account/);
});
