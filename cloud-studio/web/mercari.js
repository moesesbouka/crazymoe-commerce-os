'use strict';
const $=id=>document.getElementById(id),auth=studioAuth.auth;
const backend='https://sfheqjnxlkygjfohoybo.supabase.co',publicKey='sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af';
const form=$('listing-form'),names=['title','description','price','condition','category','brand'];
const labels={needs_details:'Needs details',ready:'Ready',posted:'Posted',sold:'Sold',cancelled:'Removed'};
let inventory=[],queue=[],presets=[],selected=new Map(),page=0,total=0,current=null,dirty=false,busy=false,sessionEpoch=0;
let photoRows=[],photoEpoch=0,photoUrls=new Set();
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function status(text){$('status').textContent=text;}
async function rpc(name,args={}){
 const epoch=sessionEpoch,{data,error}=await auth.getSession();if(error||!data.session)throw Error('Sign in to Studio to continue.');
 const response=await fetch(backend+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',headers:{apikey:publicKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 const body=await response.json();if(epoch!==sessionEpoch)throw Error('Your sign-in changed. Refresh to continue.');
 if(!response.ok)throw Error(body.message||body.error||'Request failed');return body;
}
async function action(fn){if(busy)return;busy=true;$('workspace').inert=true;$('status').setAttribute('aria-busy','true');try{await fn();}catch(error){status(error.message);}finally{busy=false;$('workspace').inert=false;$('status').setAttribute('aria-busy','false');}}
function view(name){for(const key of ['browse','queue','presets']){$(key+'-view').hidden=key!==name;$(key+'-tab').setAttribute('aria-selected',String(key===name));}}
function change(){dirty=true;$('save-state').textContent='Unsaved changes';counts();}
function counts(){const t=form.elements.title.value.length,d=form.elements.description.value.length;$('title-count').textContent=t+'/80';$('description-count').textContent=d+'/1,000';$('title-count').classList.toggle('over',t>80);$('description-count').classList.toggle('over',d>1000);}
function shippingFields(parent,values,onchange){
 parent.replaceChildren();
 for(const [key,label] of Object.entries({payer:'Who pays shipping?',weight_oz:'Packed weight (oz)',length_in:'Length (in)',width_in:'Width (in)',height_in:'Height (in)'})){
  const l=node('label',label),input=node(key==='payer'?'select':'input');input.name=key;
  if(key==='payer')input.append(new Option('Buyer','buyer'),new Option('Seller','seller'));else{input.inputMode='decimal';input.placeholder='Measured value';}
  input.value=values[key]||'';input.oninput=onchange||(()=>{});l.append(input);parent.append(l);
 }
}
function readShipping(parent){return Object.fromEntries([...parent.querySelectorAll('input,select')].map(e=>[e.name,e.value.trim()]));}
function setShipping(parent,values){for(const input of parent.querySelectorAll('input,select'))input.value=values[input.name]||'';}
function draft(){return {...Object.fromEntries(names.map(k=>[k,form.elements[k].value.trim()])),shipping:readShipping($('shipping-fields')),photos:photoRows.filter(p=>p.checked).map(p=>p.photo),photos_confirmed:form.elements.photos_confirmed.checked};}
function clearPhotos(){photoEpoch++;for(const url of photoUrls)URL.revokeObjectURL(url);photoUrls.clear();}
async function photoBytes(photo){
 let url=photo.url;
 if(photo.sha){
  const {data,error}=await auth.getSession();if(error||!data.session)throw Error('Sign in to download photos.');
  const r=await fetch(backend+'/functions/v1/studio-api/photo/'+photo.sha,{cache:'no-store',headers:{apikey:publicKey,Authorization:'Bearer '+data.session.access_token}});
  const result=await r.json();if(!r.ok||!result.url)throw Error('A private product photo is unavailable.');url=result.url;
 }
 if(!url)throw Error('Photo URL unavailable.');
 const u=new URL(url);
 if(u.origin!==backend||!u.pathname.startsWith('/storage/v1/object/'))throw Error('Photo source is not part of your inventory.');
 const r=await fetch(url,{cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok)throw Error('A product photo could not be downloaded.');
 const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>16000000)throw Error('A photo exceeds 16 MB.');
 if(photo.sha){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==photo.sha||bytes.length!==photo.bytes)throw Error('A product photo failed its integrity check.');}
 MercariCopy.format(photo,bytes);return bytes;
}
function renderPhotos(){
 clearPhotos();const epoch=photoEpoch,container=$('photos');container.replaceChildren();
 photoRows.forEach((row,index)=>{
  const card=node('div',undefined,'photo'),img=node('img');img.alt='Product photo '+(index+1);img.loading='lazy';
  const actions=node('div',undefined,'photo-actions'),l=node('label'),check=node('input');check.type='checkbox';check.checked=row.checked;check.disabled=['posted','sold','cancelled'].includes(current.state);
  check.onchange=()=>{row.checked=check.checked;change();};l.append(check,node('span',index===0?'Cover':'Use'));
  actions.append(l);
  for(const [delta,label] of [[-1,'←'],[1,'→']]){const b=node('button',label);b.type='button';b.setAttribute('aria-label',`Move photo ${index+1} ${delta<0?'earlier':'later'}`);b.disabled=index+delta<0||index+delta>=photoRows.length||['posted','sold','cancelled'].includes(current.state);b.onclick=()=>{const moved=photoRows.splice(index,1)[0];photoRows.splice(index+delta,0,moved);change();renderPhotos();};actions.append(b);}
  card.append(img,actions);container.append(card);
  photoBytes(row.photo).then(bytes=>{if(epoch!==photoEpoch)return;const url=URL.createObjectURL(new Blob([bytes],{type:'image/'+MercariCopy.format(row.photo,bytes).replace('jpg','jpeg')}));photoUrls.add(url);img.src=url;}).catch(()=>{if(epoch===photoEpoch){img.hidden=true;card.prepend(node('p','Preview unavailable','hint'));}});
 });
 if(!photoRows.length)container.append(node('p','No eligible product photos. Add your actual item photos in Studio first.','hint'));
}
function presetOptions(){
 for(const id of ['batch-preset','editor-preset']){const e=$(id),value=e.value;e.replaceChildren(new Option(id==='batch-preset'?'Fill shipping later':'Choose a preset…',''),...presets.map(p=>new Option(p.name,p.id)));e.value=presets.some(p=>p.id===value)?value:'';}
 $('presets-list').replaceChildren();for(const p of presets){const card=node('article',undefined,'preset-card'),text=node('div'),s=p.shipping;text.append(node('strong',p.name),node('p',`${s.weight_oz} oz · ${s.length_in} × ${s.width_in} × ${s.height_in} in · ${s.payer} pays`));const edit=node('button','Load to edit');edit.onclick=()=>{$('preset-form').elements.name.value=p.name;setShipping($('preset-shipping'),p.shipping);};card.append(text,edit);$('presets-list').append(card);}
}
function renderQueue(){
 const filter=$('queue-filter').value,rows=queue.filter(q=>filter==='all'||(filter==='open'?['ready','needs_details'].includes(q.state):q.state===filter));
 $('queue-list').replaceChildren();for(const q of rows){const b=node('button',q.draft.title||'Untitled product','queue-item'+(q.id===current?.id?' active':''));b.append(node('span',(q.stale?'Source changed · ':!q.available?'Unavailable · ':'')+labels[q.state]+' · $'+q.draft.price));b.onclick=()=>action(async()=>{await save();open(q.id);});$('queue-list').append(b);}
 if(!rows.length)$('queue-list').append(node('p','No items in this view.','hint'));
 $('queue-count').textContent=queue.filter(q=>['ready','needs_details'].includes(q.state)).length;$('ready-count').textContent=queue.filter(q=>q.state==='ready'&&!q.stale&&q.available).length;
}
async function loadState(){const data=await rpc('studio_mercari_state');queue=data.queue;presets=data.presets;presetOptions();renderQueue();}
function open(id){
 const q=queue.find(q=>q.id===id);current=q||null;dirty=false;clearPhotos();$('editor-body').hidden=!q;$('empty-editor').hidden=!!q;if(!q)return;
 for(const k of names)form.elements[k].value=q.draft[k]||'';
 form.elements.photos_confirmed.checked=q.draft.photos_confirmed;
 $('item-name').textContent=q.draft.title||'Untitled product';$('item-source').textContent=(q.source_kind==='studio'?'Studio product':'Imported listing')+' / '+q.source_id;
 $('item-state').textContent=labels[q.state];$('stale-note').hidden=!(q.stale||!q.available||q.state==='cancelled');$('rebuild').hidden=!['needs_details','ready','cancelled'].includes(q.state)||!q.available;
 $('issues').replaceChildren(...q.issues.map(i=>node('li',i)));
 $('source-description').textContent=q.source_snapshot.fields?.description||q.source_snapshot.suggestions?.description||'';
 const removed=MercariCopy.clean($('source-description').textContent).removed;$('removed-copy').textContent=removed.length?'Removed promotional text: '+removed.join(' / '):'No promotional text removed.';
 $('category-hint').textContent='Original category: '+(q.source_snapshot.fields?.category||'not supplied');
 $('photo-confirm-label').hidden=q.source_kind!=='imported';
 photoRows=q.draft.photos.map(p=>({photo:p,checked:true}));
 for(const p of q.source_snapshot.photos||[])if(!q.draft.photos.some(selected=>JSON.stringify(selected)===JSON.stringify(p)))photoRows.push({photo:p,checked:false});
 shippingFields($('shipping-fields'),q.draft.shipping,change);
 const closed=['posted','sold','cancelled'].includes(q.state);
 for(const input of form.querySelectorAll('input,textarea,select'))input.disabled=closed;
 $('save-draft').disabled=closed;$('apply-preset').disabled=closed;$('save-state').textContent='Saved';
 $('download-pack').disabled=['sold','cancelled'].includes(q.state)||q.stale||!q.available;
 $('done-next').disabled=q.state!=='ready'||q.stale||!q.available;$('listing-url').disabled=q.state!=='ready';$('listing-url').value=q.listing_url||'';
 $('publication').hidden=['sold','cancelled'].includes(q.state);$('published-link').hidden=!q.listing_url;if(q.listing_url)$('published-link').href=q.listing_url;
 $('done-next').hidden=q.state==='posted';$('mark-sold').hidden=['sold','cancelled'].includes(q.state);$('cancel-item').hidden=!['ready','needs_details'].includes(q.state);$('sold-note').hidden=q.state!=='sold';
 renderPhotos();counts();renderQueue();
}
async function save(){
 if(!current||!dirty)return;
 const id=current.id;
 await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'save',p_draft:draft()});dirty=false;
 await loadState();open(id);status('Listing saved. '+(current.state==='ready'?'Ready to list on Mercari.':'Complete the highlighted details when ready.'));
}
function next(after){const rows=queue.filter(q=>['ready','needs_details'].includes(q.state));const position=rows.findIndex(q=>q.id===after);return rows[position+1]?.id||rows.find(q=>q.id!==after)?.id||null;}
async function loadInventory(){
 const result=await rpc('studio_mercari_inventory',{p_kind:$('source').value,p_query:$('search').value.trim(),p_offset:page*24,p_limit:24});inventory=result.items;total=result.total;renderInventory();
}
function renderInventory(){
 $('inventory').replaceChildren();for(const item of inventory){
  const prepared=queue.find(q=>q.source_kind===item.source_kind&&q.source_id===item.source_id),key=item.source_kind+':'+item.source_id;
  const card=node('article',undefined,'product'+(selected.has(key)?' selected':'')),l=node('label'),check=node('input');check.type='checkbox';check.checked=selected.has(key);check.disabled=!!prepared;check.setAttribute('aria-label','Select '+(item.fields.title||item.suggestions?.title||item.source_id));
  check.onchange=()=>{if(check.checked&&selected.size>=50){check.checked=false;status('Select up to 50 products per batch.');return;}if(check.checked)selected.set(key,item);else selected.delete(key);renderInventory();};
  l.append(check,node('span',item.fields.title||item.suggestions?.title||item.source_id));card.append(l,node('p',prepared?labels[prepared.state]+' · already in your Mercari queue':'$'+(item.fields.price||item.suggestions?.price||'—')+' · '+item.photos.length+' eligible photos','meta'));
  if(prepared){const b=node('button','Open queue item');b.onclick=()=>action(async()=>{await save();$('queue-filter').value='all';view('queue');open(prepared.id);});card.append(b);}
  $('inventory').append(card);
 }
 if(!inventory.length)$('inventory').append(node('p','No products found. Try another source or search.','hint'));
 $('inventory-summary').textContent=total+' products in this source · '+selected.size+' selected';$('selected-count').textContent=selected.size;
 $('page-info').textContent=total?`${page*24+1}–${Math.min((page+1)*24,total)} of ${total}`:'0 products';$('previous-page').disabled=page===0;$('next-page').disabled=(page+1)*24>=total;
}
async function downloadPack(){
 await save();const epoch=sessionEpoch,id=current.id;
 const q=await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'download'}),entries=[{name:'listing.txt',data:MercariCopy.listingText(q.draft)}];let totalBytes=0;
 for(const [i,photo] of q.draft.photos.entries()){
  status(`Downloading photo ${i+1} of ${q.draft.photos.length}…`);const bytes=await photoBytes(photo);if(epoch!==sessionEpoch)throw Error('Signed out. Download stopped.');totalBytes+=bytes.length;if(totalBytes>150*1024*1024)throw Error('This photo pack is too large. Select fewer photos.');entries.push({name:`photos/${String(i+1).padStart(2,'0')}.${MercariCopy.format(photo,bytes)}`,data:bytes});
 }
 await rpc('studio_mercari_update',{p_id:id,p_revision:q.revision,p_action:'download'});
 const url=URL.createObjectURL(studioWorkflows.zip(entries)),a=node('a');a.href=url;a.download='CrazyMoe-Mercari-'+q.source_kind+'-'+q.source_id+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Listing pack downloaded. Extract the ZIP, then attach its ordered photos in Mercari.');
}
form.noValidate=true;form.onsubmit=e=>{e.preventDefault();action(save);};form.oninput=change;
for(const b of document.querySelectorAll('[data-copy]'))b.onclick=async()=>{const text=form.elements[b.dataset.copy].value;try{await navigator.clipboard.writeText(text);status('Copied '+b.dataset.copy+'.');}catch{form.elements[b.dataset.copy].focus();form.elements[b.dataset.copy].select();status('Press Ctrl+C to copy the selected text.');}};
$('download-pack').onclick=()=>action(downloadPack);
$('browse-tab').onclick=()=>action(async()=>{await save();view('browse');await loadInventory();});
$('queue-tab').onclick=()=>action(async()=>{await save();await loadState();view('queue');open(current?.id||queue.find(q=>['ready','needs_details'].includes(q.state))?.id);});
$('presets-tab').onclick=()=>action(async()=>{await save();view('presets');});
$('search-button').onclick=()=>action(async()=>{selected.clear();page=0;await loadInventory();});$('search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('search-button').click();}};
$('source').onchange=()=>action(async()=>{selected.clear();page=0;await loadInventory();});
$('previous-page').onclick=()=>action(async()=>{page--;await loadInventory();});$('next-page').onclick=()=>action(async()=>{page++;await loadInventory();});
$('select-page').onclick=()=>{for(const i of inventory){if(selected.size>=50)break;if(!queue.some(q=>q.source_kind===i.source_kind&&q.source_id===i.source_id))selected.set(i.source_kind+':'+i.source_id,i);}renderInventory();};
$('clear-selection').onclick=()=>{selected.clear();renderInventory();};
$('prepare-selected').onclick=()=>action(async()=>{
 if(!selected.size)throw Error('Choose products first.');const preset=presets.find(p=>p.id===$('batch-preset').value);
 const rows=[...selected.values()].map(s=>({source_kind:s.source_kind,source_id:s.source_id,digest:s.digest,draft:MercariCopy.prepare(s,preset?.shipping)}));
 const result=await rpc('studio_mercari_prepare',{p_rows:rows});selected.clear();await loadState();renderInventory();view('queue');$('queue-filter').value='open';open(result[0].id);status(result.filter(r=>r.created).length+' products prepared. Complete any highlighted details; your queue is saved.');
});
$('apply-preset').onclick=()=>{const p=presets.find(p=>p.id===$('editor-preset').value);if(!p){status('Choose a shipping preset first.');return;}setShipping($('shipping-fields'),p.shipping);change();};
$('preset-form').onsubmit=e=>{e.preventDefault();action(async()=>{await rpc('studio_mercari_preset',{p_name:e.target.elements.name.value.trim(),p_shipping:readShipping($('preset-shipping'))});await loadState();status('Shipping preset saved. Choose it when preparing a batch or editing a listing.');});};
$('refresh-queue').onclick=()=>action(async()=>{await save();const id=current?.id;await loadState();open(id);status('Queue refreshed.');});$('queue-filter').onchange=renderQueue;
$('skip-item').onclick=()=>action(async()=>{const id=current?.id;await save();open(next(id));status('Progress saved. Next product loaded.');});
$('done-next').onclick=()=>action(async()=>{const enteredUrl=$('listing-url').value.trim();await save();const id=current.id,url=MercariCopy.itemUrl(enteredUrl);if(!url)throw Error('Paste the published Mercari item link.');await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'posted',p_url:url});await loadState();open(next(id));status('Posted link recorded. Next product loaded.');});
$('mark-sold').onclick=()=>action(async()=>{await save();const id=current.id;await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'sold'});await loadState();open(next(id));status('Marked sold in your Mercari queue. Update any other live listings for this product.');});
$('cancel-item').onclick=()=>action(async()=>{const id=current.id;await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'cancel'});dirty=false;await loadState();open(next(id));status('Removed from your queue. The inventory product is preserved.');});
$('rebuild').onclick=()=>action(async()=>{
 const id=current.id,kind=current.source_kind,sourceId=current.source_id,shipping=readShipping($('shipping-fields'));
 const found=await rpc('studio_mercari_inventory',{p_kind:kind,p_query:'',p_offset:0,p_limit:200});let source=found.items.find(s=>s.source_id===sourceId);
 for(let offset=200;!source&&offset<found.total;offset+=200){const more=await rpc('studio_mercari_inventory',{p_kind:kind,p_offset:offset,p_limit:200});source=more.items.find(s=>s.source_id===sourceId);}
 if(!source)throw Error('Product no longer available in inventory.');
 await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'rebuild',p_draft:MercariCopy.prepare(source,shipping)});dirty=false;await loadState();open(id);status('Mercari draft rebuilt from the latest source. Shipping details preserved.');
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){sessionEpoch++;clearPhotos();queue=[];inventory=[];presets=[];selected.clear();current=null;dirty=false;$('workspace').hidden=true;$('login-note').hidden=false;for(const id of ['inventory','queue-list','photos','presets-list'])$(id).replaceChildren();status('Signed out. Sign in to use your private queue.');}});
async function initialize(){await auth.initialize();const {data}=await auth.getSession();if(!data.session){$('login-note').hidden=false;status('Sign in with your existing Studio account.');return;}await loadState();await loadInventory();$('login-note').hidden=true;$('workspace').hidden=false;view('browse');status('Choose products to prepare, or continue your saved Mercari queue.');}
$('retry-login').onclick=()=>action(initialize);
shippingFields($('preset-shipping'),MercariCopy.shipping());action(initialize);
