const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright');
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
 const context={document:{querySelectorAll:()=>scripts.map(textContent=>({textContent}))},chrome:{runtime:{onMessageExternal:{addListener:()=>{}}}},studioOrigins:new Set(),console};
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
test('mobile and desktop batch workflow preserves source and tracks filled separately',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let queued=[],preparedRows,claims=0;
  const account={id:'11111111-1111-4111-8111-111111111111',label:'Second seller',profile_id:'1999999999999'};
  await page.route('https://studio.test/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'posting.html';
   if(name==='auth.js')return route.fulfill({contentType:'application/javascript',body:'window.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:"fixture"}}}),onAuthStateChange:()=>{}}};'});
   if(!['posting.html','posting.js','posting.css','posting-copy.js'].includes(name))return route.abort();
   await route.fulfill({path:path.join(__dirname,name),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});
  });
  await page.route('https://sfheqjnxlkygjfohoybo.supabase.co/**',async route=>{
   const url=route.request().url();if(!url.includes('/rpc/'))return route.fulfill({status:404});const name=url.split('/').pop(),args=route.request().postDataJSON();let result;
   if(name==='studio_posting_accounts')result=[account];
   else if(name==='studio_posting_inventory')result={total:2,items:[item,{...item,id:2,title:'Missing condition',condition:null}]};
   else if(name==='studio_posting_queue')result=queued;
   else if(name==='studio_posting_prepare'){preparedRows=args.p_rows;queued=[{id:'22222222-2222-4222-8222-222222222222',source_id:1,account_id:account.id,account_label:account.label,revision:1,draft:args.p_rows[0].draft,state:'prepared',created_at:'2026-11-07T00:00:00Z'}];result=[queued[0].id];}
   else if(name==='studio_posting_claim'){claims++;queued[0].state='filled';result={token:'a'.repeat(64)};}
   else if(name==='studio_posting_result'){assert.equal(args.p_action,'submitted');queued[0].state='submitted';queued[0].listing_id='1999999999999';result={ok:true};}
   else return route.fulfill({status:400,json:{message:name}});
   await route.fulfill({json:result});
  });
  await page.addInitScript(()=>{window.chrome={runtime:{sendMessage:async(id,msg)=>msg.type==='STUDIO_ACCOUNT_QUEUE_CHECK'?{ready:true}:{ok:true,filled:true}}};});
  await page.goto('https://studio.test/posting.html');await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('input[type=checkbox]:disabled').count(),1);
  await page.locator('#select-visible').click();assert.equal(await page.locator('#selection-count').textContent(),'1');
  await page.locator('#review-selected').click();await page.locator('.photo-choice').nth(1).click();
  await page.locator('#prepare-batch').click();await page.locator('.queue-card').waitFor();
  assert.equal(preparedRows[0].draft.images[0],item.images[1]);assert.ok(preparedRows[0].draft.description.includes('Glass top cracked.'));assert.equal(item.images[0],photo);
  await page.locator('#start-queue').click();await page.getByText('Draft filled',{exact:true}).waitFor();assert.equal(claims,1);
  await page.locator('#start-queue').click();await page.waitForTimeout(50);assert.equal(claims,1);
  await page.locator('.queue-card input[type=url]').fill('https://www.facebook.com/marketplace/item/1999999999999/');await page.getByRole('button',{name:'Save link',exact:true}).click();await page.getByText('Publication recorded',{exact:true}).waitFor();
  assert.equal(await page.getByText('Confirmed live',{exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(__dirname,'posting-test-'+width+'.png'),fullPage:true});await page.close();
 }}finally{await browser.close();}
});
