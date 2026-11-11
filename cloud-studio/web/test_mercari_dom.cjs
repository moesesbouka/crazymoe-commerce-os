// Integration of the real HTML and browser scripts with synthetic API responses.
// Run with jsdom available on NODE_PATH; production data is never changed.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const root=process.env.MERCARI_WEB_ROOT||__dirname,out=process.env.MERCARI_TEST_OUTPUT||'/tmp/mercari-tests';fs.mkdirSync(out,{recursive:true});
const photo=new Uint8Array([255,216,255,0,1,255,217]),photoUrl='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/1/photo.jpg';
const sources=[1,2].map(id=>({source_kind:'imported',source_id:String(id),digest:'digest'+id,available:true,fields:{title:'Speaker '+id,description:'Original speaker. Scratched cabinet.\nCash App and pickup at our warehouse.\nIncludes power cable.',price:'100',condition:'Used - Good',category:'Audio'},brand:'',photos:[{url:photoUrl,kind:'imported'}]}));
function issues(d){return [...(!d.category?['Choose the Mercari category']:[]),...(!d.brand?['Enter brand']:[]),...(!d.photos_confirmed?['Confirm photo source']:[]),...(!d.shipping.weight_oz?['Enter packed weight']:[])];}
const dom=new JSDOM(fs.readFileSync(path.join(root,'mercari.html'),'utf8'),{url:'https://studio.crazymoe.com/mercari.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
let queue=[],presets=[],failSave=false,logout,latestDownload;const blobs=new Map();
w.structuredClone=structuredClone;w.TextEncoder=TextEncoder;w.Blob=Blob;Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.URL.createObjectURL=b=>{const key='blob:fixture-'+blobs.size;blobs.set(key,b);return key;};w.URL.revokeObjectURL=key=>blobs.delete(key);
w.document.addEventListener('click',event=>{if(event.target.tagName==='A'){event.preventDefault();if(event.target.download)latestDownload=blobs.get(event.target.href);}});
w.MercariBridge={request:async()=>({ok:true,version:2}),onResult:()=>{}};
w.studioAuth={auth:{initialize:async()=>{},getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange:cb=>logout=()=>cb('SIGNED_OUT')}};
w.fetch=async(url,options={})=>{
 if(url.includes('/storage/'))return {ok:true,arrayBuffer:async()=>photo.buffer};
 const name=url.split('/').pop(),a=JSON.parse(options.body||'{}');let data;
 if(name==='studio_mercari_categories')data={paths:[]};
 else if(name==='studio_mercari_inventory')data={items:sources,total:sources.length};
 else if(name==='studio_mercari_state')data={queue,presets};
 else if(name==='studio_mercari_prepare')data=a.p_rows.map((r,i)=>{const q={id:'q'+i,source_kind:r.source_kind,source_id:r.source_id,source_digest:r.digest,source_snapshot:sources.find(s=>s.source_id===r.source_id),draft:r.draft,state:'needs_details',revision:1,stale:false,available:true,issues:issues(r.draft)};queue.push(q);return {id:q.id,created:true};});
 else if(name==='studio_mercari_preset'){presets=[{id:'p1',name:a.p_name,shipping:a.p_shipping}];data=presets[0];}
 else if(name==='studio_mercari_update'){
  const q=queue.find(q=>q.id===a.p_id);
  if(a.p_action==='save'&&failSave)return {ok:false,status:409,json:async()=>({message:'This queue item changed on another device. Refresh before saving.'})};
  if(a.p_action==='save'){q.draft=a.p_draft;q.issues=issues(q.draft);q.state=q.issues.length?'needs_details':'ready';q.revision++;}
  if(a.p_action==='posted'){q.state='posted';q.listing_url=a.p_url;q.revision++;}
  if(a.p_action==='rebuild'){q.draft=a.p_draft;q.stale=false;q.revision++;q.issues=issues(q.draft);q.state=q.issues.length?'needs_details':'ready';}
  data=q;
 }else throw Error('Unexpected API request '+name);
 return {ok:true,json:async()=>structuredClone(data)};
};
for(const file of ['workflows.js','mercari-copy.js','mercari-categories.js','mercari.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
const $=id=>w.document.getElementById(id);
const wait=async(check)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+check+'; status='+$('status').textContent);};
const idle=()=>wait(()=>$('workspace').inert===false);
const click=async id=>{$(id).click();await idle();};
const input=(selector,value)=>{const e=w.document.querySelector(selector);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));return e;};
(async()=>{
 await wait(()=>!$('workspace').hidden);await idle();assert.equal($('source').value,'imported');assert.equal(w.document.querySelectorAll('#inventory .cover-frame').length,2);assert.equal(w.document.querySelector('#inventory img').hidden,false,'Lazy cover image must occupy layout to load');await click('inventory-table-view');assert.equal(w.document.querySelectorAll('#inventory-table-body tr').length,2);await click('inventory-grid');
 $('source').value='imported';$('source').dispatchEvent(new w.Event('change'));await idle();await click('select-page');await click('prepare-selected');
 assert.equal(queue.length,2);assert.equal(w.document.querySelector('[name=condition]').value,'Good');
 assert.match(w.document.querySelector('[name=description]').value,/Scratched cabinet/);assert.doesNotMatch(w.document.querySelector('[name=description]').value,/Cash App|pickup/);
 await click('presets-tab');input('#preset-form [name=name]','Small speaker');for(const k of ['weight_oz','length_in','width_in','height_in'])input('#preset-shipping [name='+k+']',k==='weight_oz'?'32':'10');
 $('preset-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await idle();assert.equal(presets.length,1);
 await click('queue-tab');$('editor-preset').value='p1';await click('apply-preset');input('[name=brand]','Test brand');input('[name=category]','Electronics / Audio / Speakers');input('[name=photos_confirmed]',true);
 $('listing-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await idle();assert.equal(queue[0].state,'ready');
 await click('download-pack');assert.ok(latestDownload);fs.writeFileSync(path.join(out,'listing.zip'),Buffer.from(await latestDownload.arrayBuffer()));
 failSave=true;input('[name=title]','Preserve my edit');$('listing-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await idle();assert.equal(w.document.querySelector('[name=title]').value,'Preserve my edit');assert.match($('status').textContent,/another device/);failSave=false;
 // The dirty save must not clear the link entered before Done -> Next.
 input('#listing-url','https://www.mercari.com/us/item/m123456789/');await click('done-next');assert.equal(queue[0].state,'posted');assert.equal(queue[0].listing_url,'https://www.mercari.com/us/item/m123456789/');assert.equal(w.document.querySelector('[name=title]').value,'Speaker 2');
 // Refreshing restores persisted draft data and retains the current next item.
 await click('refresh-queue');assert.equal(w.document.querySelector('[name=title]').value,'Speaker 2');
 sources[1].digest='changed';queue[1].stale=true;await click('refresh-queue');assert.equal($('stale-note').hidden,false);assert.equal($('download-pack').disabled,true);await click('rebuild');assert.equal($('stale-note').hidden,true);
 assert.equal(w.MercariCopy.itemUrl('https://mercari.com.evil.example/us/item/m123/'),null);
 assert.equal(w.MercariCopy.condition('For parts or not working'),'');
 assert.match(w.MercariCopy.clean('Scratched cabinet. Cash App accepted.').text,/Scratched cabinet/);
 assert.equal(w.MercariCopy.clean('Scratched cabinet. Cash App accepted.').text,'Scratched cabinet.');
 assert.equal(w.MercariCopy.clean('Scratched cabinet.\n\nInternal notes: supplier cost $20\nStaff only.\n\nIncludes cable.\nSKU: warehouse-123').text,'Scratched cabinet.\n\nIncludes cable.');
 logout();assert.equal($('workspace').hidden,true);assert.equal($('login-note').hidden,false);assert.equal($('photos').children.length,0);
 console.log('PASS: real UI scripts — batch, cleanup, preset, save, conflict, photo ZIP, posted link with dirty edit, next item, refresh, stale-source rebuild, logout.');
 dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
