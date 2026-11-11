// Browser story tests use synthetic inventory; they never access Mercari.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.MERCARI_WEB_ROOT||path.join(__dirname),out=process.env.MERCARI_TEST_OUTPUT||'/tmp/mercari-tests';fs.mkdirSync(out,{recursive:true});
const photo=Buffer.from('ffd8ff0001ffd9','hex'),photoUrl='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/1/photo.jpg';
const sources=[1,2].map(id=>({source_kind:'imported',source_id:String(id),digest:'digest'+id,available:true,fields:{title:'Speaker '+id,description:'Original speaker. Scratched cabinet.\nCash App and pickup at our warehouse.\nIncludes power cable.',price:'100',condition:'Used - Good',category:'Audio'},brand:'',photos:[{url:photoUrl,kind:'imported'}]}));
function problems(d){return [...(!d.category?['Choose the Mercari category']:[]),...(!d.brand?['Enter the brand, or No brand']:[]),...(!d.photos_confirmed?['Confirm imported photos are your own actual product photos']:[]),...(!d.shipping.weight_oz?['Enter packed weight oz']:[])];}
const server=http.createServer((req,res)=>{let p=path.join(root,req.url.split('?')[0]);try{const bytes=fs.readFileSync(p);res.setHeader('content-type',p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'application/javascript');res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{for(const width of [1440,390]){
  let queue=[],presets=[],failSave=false;
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/auth.js',r=>r.fulfill({contentType:'application/javascript',body:`globalThis.studioAuth={auth:{initialize:async()=>{},getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange:cb=>globalThis.fixtureSignOut=()=>cb('SIGNED_OUT')}};`}));
  await page.route('https://sfheqjnxlkygjfohoybo.supabase.co/**',async route=>{
   if(route.request().url().includes('/storage/'))return route.fulfill({body:photo,contentType:'image/jpeg'});
   const name=route.request().url().split('/').pop(),args=route.request().postDataJSON();let result;
   if(name==='studio_mercari_inventory')result={items:sources,total:sources.length};
   else if(name==='studio_mercari_state')result={queue,presets};
   else if(name==='studio_mercari_prepare'){result=args.p_rows.map((r,i)=>{const q={id:'q'+i,source_kind:r.source_kind,source_id:r.source_id,source_digest:r.digest,source_snapshot:sources.find(s=>s.source_id===r.source_id),draft:r.draft,state:'needs_details',revision:1,stale:false,available:true,issues:problems(r.draft)};queue.push(q);return {id:q.id,created:true};});}
   else if(name==='studio_mercari_preset'){presets=[{id:'p1',name:args.p_name,shipping:args.p_shipping}];result=presets[0];}
   else if(name==='studio_mercari_update'){
    const q=queue.find(q=>q.id===args.p_id);
    if(args.p_action==='save'&&failSave)return route.fulfill({status:409,json:{message:'This queue item changed on another device. Refresh before saving.'}});
    if(args.p_action==='save'){q.draft=args.p_draft;q.issues=problems(q.draft);q.state=q.issues.length?'needs_details':'ready';q.revision++;}
    if(args.p_action==='posted'){q.state='posted';q.listing_url=args.p_url;q.revision++;}
    if(args.p_action==='rebuild'){q.draft=args.p_draft;q.stale=false;q.revision++;q.issues=problems(q.draft);q.state='needs_details';}
    result=q;
   }else throw Error('Unexpected RPC '+name);
   return route.fulfill({json:result});
  });
  await page.goto(origin+'/mercari.html');await page.locator('#workspace').waitFor({state:'visible'});
  await page.locator('#source').selectOption('imported');await page.getByRole('button',{name:'Select this page',exact:true}).click();
  await page.getByRole('button',{name:'Prepare selected (2)',exact:true}).click();await page.locator('#editor-body').waitFor({state:'visible'});
  assert.equal(await page.locator('[name=condition]').inputValue(),'Good');
  assert.match(await page.locator('[name=description]').inputValue(),/Scratched cabinet/);assert.doesNotMatch(await page.locator('[name=description]').inputValue(),/Cash App|pickup/);
  await page.screenshot({path:path.join(out,`mercari-${width}-needs-details.png`),fullPage:true});
  await page.getByRole('tab',{name:'Shipping presets',exact:true}).click();await page.locator('#preset-form [name=name]').fill('Small speaker');
  for(const k of ['weight_oz','length_in','width_in','height_in'])await page.locator('#preset-shipping [name='+k+']').fill(k==='weight_oz'?'32':'10');
  await page.getByRole('button',{name:'Save shipping preset',exact:true}).click();await page.locator('#status').filter({hasText:'Shipping preset saved'}).waitFor();
  await page.getByRole('tab',{name:/Your queue/}).click();
  await page.locator('#editor-preset').selectOption('p1');await page.getByRole('button',{name:'Apply preset',exact:true}).click();
  await page.locator('[name=brand]').fill('Test brand');await page.locator('[name=category]').fill('Electronics / Audio / Speakers');await page.locator('[name=photos_confirmed]').check();
  await page.getByRole('button',{name:'Save listing',exact:true}).click();await page.locator('#item-state').filter({hasText:'Ready'}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download listing + photos',exact:true}).click();const download=await downloadPromise;await download.saveAs(path.join(out,`listing-${width}.zip`));
  await page.locator('#status').filter({hasText:'Listing pack downloaded'}).waitFor();
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.getByRole('tab',{name:/Your queue/}).click();
  assert.equal(await page.locator('[name=brand]').inputValue(),'Test brand');
  // A conflict must preserve unsaved user text.
  failSave=true;await page.locator('[name=title]').fill('Preserve my edit');await page.getByRole('button',{name:'Save listing',exact:true}).click();await page.locator('#status').filter({hasText:'another device'}).waitFor();assert.equal(await page.locator('[name=title]').inputValue(),'Preserve my edit');failSave=false;
  // Posting with dirty fields must preserve the entered publication link.
  await page.locator('#listing-url').fill('https://www.mercari.com/us/item/m123456789/');await page.getByRole('button',{name:'Save posted link → Next item',exact:true}).click();await page.locator('#status').filter({hasText:'Posted link recorded'}).waitFor();
  assert.equal(queue[0].listing_url,'https://www.mercari.com/us/item/m123456789/');assert.equal(await page.locator('[name=title]').inputValue(),'Speaker 2');
  await page.screenshot({path:path.join(out,`mercari-${width}-next-item.png`),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'Horizontal overflow at '+width);
  await page.evaluate(()=>fixtureSignOut());await page.locator('#login-note').waitFor({state:'visible'});assert.equal(await page.locator('#workspace').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS',width,'px: batch, cleanup, preset, edit, save, reload, conflict, ZIP, posted link, next item, logout');await context.close();
 }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
