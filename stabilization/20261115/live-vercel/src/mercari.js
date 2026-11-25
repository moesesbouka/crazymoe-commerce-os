'use strict';
const $=id=>document.getElementById(id),auth=studioAuth.auth;
const backend='https://sfheqjnxlkygjfohoybo.supabase.co',publicKey='sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af';
const form=$('listing-form'),names=['title','description','price','condition','category','brand'];
const labels={needs_details:'Needs details',ready:'Ready',handed_off:'Ready for manual listing',posted:'Posted',sold:'Sold',cancelled:'Removed',source_unavailable:'Source unavailable',skipped:'Skipped'};
let inventory=[],queue=[],presets=[],selected=new Map(),page=0,total=0,current=null,dirty=false,busy=false,sessionEpoch=0;
let photoRows=[],photoEpoch=0,photoUrls=new Set();
let inventoryAll=[],inventoryLayout='grid',categoryPaths=[];
const inventoryCache=new Map();
let catalog={enabled:false,choices:[],research:[]};
const itemKey=i=>i.source_kind+':'+i.source_id;
const ready=q=>['ready','handed_off'].includes(q?.state)&&q?.readiness?.ready===true&&!q.listing_url&&!q.stale&&q.available&&q.eligible!==false;
const editable=q=>!['handed_off','posted','sold','cancelled','source_unavailable','skipped'].includes(q.state);
async function loadCatalog(){catalog=await rpc('studio_mercari_catalog');renderResearch();renderQueue();}
function renderResearch(){const counts={};for(const j of catalog.research||[])counts[j.state]=(counts[j.state]||0)+1;$('research-summary').textContent=Object.entries(counts).map(([k,v])=>v+' '+k.replaceAll('_',' ')).join(' · ')||'Research starts after you save your Mercari selection.';$('research-summary').textContent+=' · '+(catalog.worker_seen_at&&Date.now()-Date.parse(catalog.worker_seen_at)<120000?'Lenovo AI connected':'Lenovo AI offline or reconnecting');}
async function catalogAction(action){if(!selected.size)throw Error('Select the products first.');catalog=await rpc('studio_mercari_catalog',{p_action:action,p_items:[...selected.values()].map(i=>({source_kind:i.source_kind,source_id:i.source_id}))});selected.clear();$('catalog-view').value='kept';page=0;renderInventory();renderQueue();renderResearch();if(action!=='exclude'){catalog=await rpc('studio_mercari_catalog',{p_action:'research'});renderResearch();}status('Mercari selection saved. Other inventory is preserved; use All products or Excluded products to restore items.');}
for(const [id,act] of [['keep-selected','keep'],['keep-only','keep_only'],['exclude-selected','exclude']])$(id).onclick=()=>action(()=>catalogAction(act));
$('catalog-view').onchange=()=>{page=0;renderInventory();};
$('research-shipping').onclick=()=>action(async()=>{catalog=await rpc('studio_mercari_catalog',{p_action:'retry_research'});renderResearch();status('Shipping research requests saved for your Mercari products. The counts show queued, running and completed results.');});
$('refresh-research').onclick=()=>action(async()=>{await save();await loadCatalog();await loadState();if(current)open(current.id);renderInventory();status('Shipping research refreshed.');});
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function status(text){$('status').textContent=text;if($('editor-status'))$('editor-status').textContent=text;}
async function rpc(name,args={}){
 const epoch=sessionEpoch,{data,error}=await auth.getSession();if(error||!data.session)throw Error('Sign in to Studio to continue.');
 const response=await fetch(backend+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',headers:{apikey:publicKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 const body=await response.json();if(epoch!==sessionEpoch)throw Error('Your sign-in changed. Refresh to continue.');
 if(!response.ok)throw Error(body.message||body.error||'Request failed');return body;
}
async function action(fn){if(busy)return;busy=true;$('workspace').inert=true;$('status').setAttribute('aria-busy','true');try{await fn();}catch(error){status(error.message);}finally{busy=false;$('workspace').inert=false;$('status').setAttribute('aria-busy','false');}}
function view(name){for(const key of ['browse','queue','presets']){$(key+'-view').hidden=key!==name;$(key+'-tab').setAttribute('aria-selected',String(key===name));}}
function change(){dirty=true;$('save-state').textContent='Unsaved changes';counts();}
function counts(){$('category-selection').textContent=form.elements.category.value.trim();const t=form.elements.title.value.length,d=form.elements.description.value.length;$('title-count').textContent=t+'/80';$('description-count').textContent=d+'/1,000';$('title-count').classList.toggle('over',t>80);$('description-count').classList.toggle('over',d>1000);}
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
function draft(){return MercariCopy.defaults({...Object.fromEntries(names.map(k=>[k,form.elements[k].value.trim()])),shipping:readShipping($('shipping-fields')),photos:photoRows.filter(p=>p.checked).map(p=>p.photo)},current.source_snapshot);}
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
 clearPhotos();const epoch=photoEpoch,container=$('photos'),locked=!editable(current);container.replaceChildren();
 photoRows.forEach((row,index)=>{
  const card=node('div',undefined,'photo'),img=node('img');img.alt='Product photo '+(index+1);img.loading='lazy';
  const actions=node('div',undefined,'photo-actions'),l=node('label'),check=node('input');check.type='checkbox';check.checked=row.checked;check.disabled=locked;
  check.onchange=()=>{row.checked=check.checked;change();};l.append(check,node('span',index===0?'Cover':'Use'));
  actions.append(l);
  for(const [delta,label] of [[-1,'←'],[1,'→']]){const b=node('button',label);b.type='button';b.setAttribute('aria-label',`Move photo ${index+1} ${delta<0?'earlier':'later'}`);b.disabled=locked||index+delta<0||index+delta>=photoRows.length;b.onclick=()=>{const moved=photoRows.splice(index,1)[0];photoRows.splice(index+delta,0,moved);change();renderPhotos();};actions.append(b);}
  card.append(img,actions);container.append(card);
  photoBytes(row.photo).then(bytes=>{if(epoch!==photoEpoch)return;const url=URL.createObjectURL(new Blob([bytes],{type:'image/'+MercariCopy.format(row.photo,bytes).replace('jpg','jpeg')}));photoUrls.add(url);img.src=url;}).catch(()=>{if(epoch===photoEpoch){img.hidden=true;card.prepend(node('p','Preview unavailable','hint'));}});
 });
 if(!photoRows.length)container.append(node('p','No eligible product photos. Add your actual item photos in Studio first.','hint'));
}
function presetOptions(){
 for(const id of ['batch-preset','editor-preset']){const e=$(id),value=e.value;e.replaceChildren(new Option(id==='batch-preset'?'Fill shipping later':'Choose a preset…',''),...presets.map(p=>new Option(p.name,p.id)));e.value=presets.some(p=>p.id===value)?value:'';}
 $('presets-list').replaceChildren();for(const p of presets){const card=node('article',undefined,'preset-card'),text=node('div'),s=p.shipping;text.append(node('strong',p.name),node('p',`${s.weight_oz} oz · ${s.length_in} × ${s.width_in} × ${s.height_in} in · ${s.payer} pays`));const edit=node('button','Load to edit');edit.onclick=()=>{$('preset-form').elements.name.value=p.name;setShipping($('preset-shipping'),p.shipping);};card.append(text,edit);$('presets-list').append(card);}
}
const kept=q=>!catalog.enabled||catalog.choices.some(c=>c.included&&itemKey(c)===itemKey(q));
function renderQueue(){
 const filter=$('queue-filter').value,rows=queue.filter(q=>filter==='all'||(kept(q)&&(filter==='open'?['ready','needs_details','handed_off','source_unavailable'].includes(q.state):q.state===filter)));
 $('queue-list').replaceChildren();for(const q of rows){const b=node('button',q.draft.title||'Untitled product','queue-item'+(q.id===current?.id?' active':''));b.append(node('span',(q.eligible===false?'Stale · ':q.stale?'Source changed · ':!q.available?'Unavailable · ':'')+(labels[q.state]||q.state)+' · $'+q.draft.price));b.onclick=()=>action(async()=>{await save();open(q.id);});$('queue-list').append(b);}
 if(!rows.length)$('queue-list').append(node('p','No items in this view.','hint'));
 $('queue-count').textContent=queue.filter(q=>kept(q)&&['ready','needs_details','handed_off','source_unavailable'].includes(q.state)).length;$('ready-count').textContent=queue.filter(q=>kept(q)&&ready(q)).length;
}
async function loadState(){const data=await rpc('studio_mercari_state');queue=data.queue;presets=data.presets;presetOptions();renderQueue();}
function open(id){
 const q=queue.find(q=>q.id===id);current=q||null;dirty=!!q?.automaticChanges;clearPhotos();$('editor-body').hidden=!q;$('empty-editor').hidden=!!q;if(!q)return;
 for(const k of names)form.elements[k].value=q.draft[k]||'';
 if(['ready','needs_details'].includes(q.state)&&!form.elements.brand.value){const inferred=MercariCopy.brand(q.source_snapshot);if(inferred){form.elements.brand.value=inferred;dirty=true;}}
 const recovered=MercariCopy.clean(q.source_snapshot.fields?.description||'').text;
 if(['ready','needs_details'].includes(q.state)&&(!form.elements.description.value||form.elements.description.value===MercariCopy.photoNotice)&&recovered){form.elements.description.value=MercariCopy.description(recovered,q.source_snapshot);dirty=true;}
 const basePrice=q.source_snapshot.fields?.price??q.source_snapshot.suggestions?.price,automaticPrice=MercariCopy.price(basePrice);
 form.elements.price.readOnly=false;
 $('price-hint').textContent=automaticPrice?'Default: Facebook $'+Number(basePrice).toFixed(2)+' + 10% = $'+automaticPrice+'. You can edit the Mercari price.':'Enter your Mercari price.';
 if(['ready','needs_details'].includes(q.state)&&!form.elements.category.value){const suggested=suggestCategory(q.source_snapshot);if(suggested){form.elements.category.value=suggested;dirty=true;}}
 $('item-name').textContent=q.draft.title||'Untitled product';$('item-source').textContent=(q.source_kind==='studio'?'Studio product':'Imported listing')+' / '+q.source_id;
 $('item-state').textContent=labels[q.state]||q.state;$('stale-note').hidden=!(q.stale||!q.available||q.eligible===false||q.state==='source_unavailable');$('rebuild').hidden=!['needs_details','ready','source_unavailable','cancelled'].includes(q.state)||!q.available;
 $('confirm-available').hidden=q.source_kind!=='imported'||!q.available||q.eligible!==false;
 const link=q.source_snapshot.physical_link,$identity=$('identity-review');$identity.hidden=!link||link.status!=='candidate';$('identity-text').textContent=link?.status==='candidate'?`Possible duplicate: Studio ${link.studio_id} and Facebook import ${link.imported_id}. Confirm only if they are the same physical unit.`:'';
 $('issues').replaceChildren(...(q.readiness?.issues||[]).map(i=>node('li',`${i.severity==='warn'?'Warning':'Blocked'} · ${i.code}: ${i.message}`)));
 $('source-description').textContent=q.source_snapshot.fields?.description||q.source_snapshot.suggestions?.description||'';
 const removed=MercariCopy.clean($('source-description').textContent).removed;$('removed-copy').textContent=removed.length?'Removed promotional text: '+removed.join(' / '):'No promotional text removed.';
 $('category-hint').textContent='Original category: '+(q.source_snapshot.fields?.category||'not supplied');
 $('source-recovery').hidden=q.source_kind!=='imported'||!['ready','needs_details'].includes(q.state);$('recovery-description').value='';$('recovery-photos').value='';
 const missing=[];if(!q.source_snapshot.fields?.description)missing.push('description is missing from the Facebook import');if((q.source_snapshot.photos||[]).length<2)missing.push('only '+(q.source_snapshot.photos||[]).length+' photo saved in the import');
 $('source-warning').hidden=!missing.length||q.source_kind!=='imported';$('source-warning').textContent='Source data: '+missing.join('; ')+'. If Facebook has more content, a fresh detail/gallery sync is needed to recover it.';
 if(q.source_kind==='studio'&&q.source_snapshot.identity_status!=='verified_exact'){$('source-warning').hidden=false;$('source-warning').textContent='The product model is not independently verified in Studio. Review the saved title, model and actual-item photos on Mercari before publishing.';}
 $('source-link').hidden=!q.source_snapshot.facebook_id;if(q.source_snapshot.facebook_id)$('source-link').href='https://www.facebook.com/marketplace/item/'+q.source_snapshot.facebook_id+'/';
 photoRows=q.draft.photos.map(p=>({photo:p,checked:true}));
 for(const p of q.source_snapshot.photos||[])if(!q.draft.photos.some(selected=>JSON.stringify(selected)===JSON.stringify(p)))photoRows.push({photo:p,checked:false});
 shippingFields($('shipping-fields'),q.draft.shipping,change);
 const research=catalog.research.find(j=>j.source_kind===q.source_kind&&j.source_id===q.source_id),note=$('shipping-research-note');note.replaceChildren();if(research){note.append(node('span','AI research: '+research.state.replaceAll('_',' ')+'. '+(research.result?.summary||'')));for(const e of research.result?.evidence||[]){const url=String(e.url||'');if(!/^https:\/\//i.test(url))continue;const a=node('a',' Source: '+(e.title||new URL(url).hostname));a.href=url;a.target='_blank';a.rel='noopener noreferrer';note.append(a);}if(research.result?.item_weight_oz)note.append(node('span',' Item weight: '+research.result.item_weight_oz+' oz.'));}
 const closed=!editable(q);$('suggest-category').disabled=closed;
 for(const input of form.querySelectorAll('input,textarea,select'))input.disabled=closed;
 $('save-draft').disabled=closed;$('apply-preset').disabled=closed;$('save-state').textContent=dirty?'Automatic details added — save to keep':'Saved';
 $('download-pack').disabled=!ready(q);
 $('open-sell').hidden=$('manual-listing-note').hidden=!ready(q);
 $('listing-url').disabled=!ready(q);$('listing-url').value=q.listing_url||'';publicationControls();
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
function next(after){const rows=queue.filter(q=>kept(q)&&['ready','needs_details','handed_off'].includes(q.state));const position=rows.findIndex(q=>q.id===after);return rows[position+1]?.id||rows.find(q=>q.id!==after)?.id||null;}
function publicationControls(){$('done-next').disabled=!ready(current)||!MercariCopy.itemUrl($('listing-url').value.trim());}
$('listing-url').oninput=publicationControls;
async function loadInventory(){
 const kind=$('source').value,cached=inventoryCache.get(kind);
 if(cached&&Date.now()-cached.time<60000)inventoryAll=cached.items;
 else{inventoryAll=[];let offset=0,expected=1;while(offset<expected){const result=await rpc('studio_mercari_inventory',{p_kind:kind,p_query:'',p_offset:offset,p_limit:200});inventoryAll.push(...result.items);expected=result.total;offset+=result.items.length;if(!result.items.length)break;}inventoryCache.set(kind,{time:Date.now(),items:inventoryAll});}
 renderInventory();
}
function coverPhoto(photo,title){
 const frame=node('div',undefined,'cover-frame'),img=node('img'),placeholder=node('span',photo?'Loading cover…':'No cover photo');img.alt=title;img.loading='lazy';img.referrerPolicy='no-referrer';img.style.opacity='0';frame.append(img,placeholder);
 if(photo){const show=url=>{if(!frame.isConnected)return;img.onload=()=>{img.style.opacity='1';placeholder.hidden=true;};img.onerror=()=>{placeholder.textContent='Cover unavailable';};img.src=url;};
  if(photo.url){queueMicrotask(()=>show(photo.url));}else if(photo.sha){auth.getSession().then(async({data})=>{if(!data.session)return;const r=await fetch(backend+'/functions/v1/studio-api/photo/'+photo.sha,{cache:'no-store',headers:{apikey:publicKey,Authorization:'Bearer '+data.session.access_token}});const b=await r.json();if(r.ok&&b.url)show(b.url);else placeholder.textContent='Cover unavailable';}).catch(()=>placeholder.textContent='Cover unavailable');}
 }return frame;
}
function renderInventory(){
 const term=$('search').value.trim().toLowerCase(),filter=$('inventory-status').value;
 const exists=i=>queue.find(q=>q.source_kind===i.source_kind&&q.source_id===i.source_id);
 const choices=new Map(catalog.choices.map(c=>[itemKey(c),c.included])),scope=$('catalog-view').value,review=$('inventory-review').value;
 const audit=catalog.audit||{};const reviewIds=new Set(review==='duplicates'?audit.duplicate_ids:review==='old'?audit.old_ids:[]);
 const inReview=i=>review==='all'||review==='fresh'&&i.eligible!==false||review==='stale'&&i.eligible===false||i.source_kind==='imported'&&reviewIds.has(i.source_id);
 let rows=inventoryAll.filter(i=>inReview(i)&&(scope==='all'||(scope==='kept'?choices.get(itemKey(i))===true:choices.get(itemKey(i))===false||(catalog.enabled&&choices.get(itemKey(i))!==true)))&&(!term||[i.fields.title,i.suggestions?.title,i.fields.category,i.source_id].join(' ').toLowerCase().includes(term))&&(filter==='all'||(filter==='queued'?!!exists(i):!exists(i))));
 const sort=$('inventory-sort').value;rows.sort((a,b)=>sort==='title'?String(a.fields.title||a.source_id).localeCompare(String(b.fields.title||b.source_id)):(Number(a.fields.price||0)-Number(b.fields.price||0))*(sort==='price-down'?-1:1));
 total=rows.length;if(page*24>=total)page=0;inventory=rows.slice(page*24,page*24+24);
 $('inventory').replaceChildren();$('inventory-table-body').replaceChildren();
 for(const item of inventory){
  const prepared=exists(item),key=item.source_kind+':'+item.source_id,title=item.fields.title||item.suggestions?.title||item.source_id;
  const card=node(inventoryLayout==='table'?'tr':'article',undefined,inventoryLayout==='table'?'':'product'+(selected.has(key)?' selected':'')),check=node('input');check.type='checkbox';check.checked=selected.has(key);check.disabled=item.eligible===false||item.physical_link?.status==='confirmed'&&item.source_kind==='imported';check.setAttribute('aria-label','Select '+title);
  check.onchange=()=>{if(check.checked)selected.set(key,item);else selected.delete(key);card.classList.toggle('selected',check.checked);$('selected-count').textContent=selected.size;};
  const mappedCondition=MercariCopy.condition(item.fields.condition),condition=mappedCondition||(item.fields.condition?'Review: '+item.fields.condition:'Assumed New'),price='$'+(item.fields.price||item.suggestions?.price||'—'),category=item.fields.category||'Uncategorized',state=prepared?(labels[prepared.state]||prepared.state):item.eligible===false?'Stale — confirm first':'Not queued';
  const mercariPrice=prepared?prepared.draft.price:MercariCopy.price(item.fields.price??item.suggestions?.price),overLimit=Number(mercariPrice)>2000;
  const origin=(item.source_kind==='imported'?'Facebook import':$('source').value==='all'?'Studio · seller reported':'Studio product')+(item.physical_link?.status==='candidate'?' · Possible duplicate':item.physical_link?.status==='confirmed'?' · Linked physical item':'');
  const targetText=mercariPrice?'Mercari $'+mercariPrice+(prepared?' (saved price)':' (includes 10%)')+(overLimit?' · Above $2,000 limit':''):'Mercari price unavailable';
  const image=coverPhoto(item.photos[0],title);
  if(inventoryLayout==='table'){
   const selectCell=node('td');selectCell.append(check);const photoCell=node('td');image.className='cover-frame table-cover';photoCell.append(image);const nameCell=node('td',title,'table-title');nameCell.append(node('span',origin+' · '+item.source_id,'table-meta'));const priceCell=node('td',price);priceCell.append(node('span',targetText,'table-meta'+(overLimit?' over-limit':'')));card.append(selectCell,photoCell,nameCell,priceCell,node('td',condition),node('td',category),node('td',state));
  }else{const l=node('label');l.append(check,node('span',title));card.append(image,l,node('p',origin,'meta'),node('p',price+' · '+condition,'meta'),node('p',targetText,'meta'+(overLimit?' over-limit':'')),node('p',category+' · '+item.photos.length+' photos'+(!item.fields.description?' · Missing description':''),'meta'),node('p',state,'meta'));}
  if(prepared){const b=node('button','Open queue item');b.onclick=()=>action(async()=>{await save();$('queue-filter').value='all';view('queue');open(prepared.id);});if(inventoryLayout==='table')card.lastChild.append(b);else card.append(b);}
  $(inventoryLayout==='table'?'inventory-table-body':'inventory').append(card);
 }
 $('inventory').hidden=inventoryLayout==='table';$('inventory-table-wrap').hidden=inventoryLayout!=='table';
 if(!inventory.length)$('inventory').append(node('p','No matching products.','hint'));
 const importedCount=inventoryAll.filter(i=>i.source_kind==='imported').length,studioCount=inventoryAll.length-importedCount;
 const sourceLabel=$('source').value==='all'?'saved products ('+importedCount+' imported + '+studioCount+' Studio-listed)':$('source').value==='imported'?'imported active records':'Studio products';
 $('catalog-note').textContent='Fresh or seller-confirmed inventory is shown by default. Keep only selected saves your Mercari shortlist across devices. Audit: '+(audit.old_ids?.length||0)+' records not seen in the last 14 days; '+(audit.duplicate_groups||0)+' possible duplicate-title groups.';
 $('inventory-summary').textContent=inventoryAll.length+' '+sourceLabel+' · '+total+' matching · '+selected.size+' selected';$('selected-count').textContent=selected.size;
 $('page-info').textContent=total?`${page*24+1}–${Math.min((page+1)*24,total)} of ${total}`:'0 products';$('previous-page').disabled=page===0;$('next-page').disabled=(page+1)*24>=total;
}
async function downloadPack(){
 await save();
 if(!ready(current))throw Error('Choose a ready, unposted item first.');
 const epoch=sessionEpoch,id=current.id;
 const q=await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'download'}),entries=[{name:'listing.txt',data:MercariCopy.listingText(q.draft)}];let totalBytes=0;
 for(const [i,photo] of q.draft.photos.entries()){
  status(`Downloading photo ${i+1} of ${q.draft.photos.length}…`);const bytes=await photoBytes(photo);if(epoch!==sessionEpoch)throw Error('Signed out. Download stopped.');totalBytes+=bytes.length;if(totalBytes>150*1024*1024)throw Error('This photo pack is too large. Select fewer photos.');entries.push({name:`photos/${String(i+1).padStart(2,'0')}.${MercariCopy.format(photo,bytes)}`,data:bytes});
 }
 await rpc('studio_mercari_update',{p_id:id,p_revision:q.revision,p_action:'download'});
 if(epoch!==sessionEpoch)throw Error('Signed out. Download stopped.');
 const url=URL.createObjectURL(studioWorkflows.zip(entries)),a=node('a');a.href=url;a.download='CrazyMoe-Mercari-'+q.source_kind+'-'+q.source_id+'.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Listing pack downloaded. Extract the ZIP and attach the photos in the fresh Mercari form.');
}
form.noValidate=true;form.onsubmit=e=>{e.preventDefault();action(save);};form.oninput=change;
function formatDescription(){const input=form.elements.description;if(!current||!['ready','needs_details'].includes(current.state))return;const formatted=MercariCopy.description(input.value,current.source_snapshot);if(input.value!==formatted){input.value=formatted;change();}}
form.elements.description.onblur=formatDescription;
for(const b of document.querySelectorAll('[data-copy]'))b.onclick=async()=>{if(b.dataset.copy==='description')formatDescription();const text=form.elements[b.dataset.copy].value;try{await navigator.clipboard.writeText(text);status('Copied '+b.dataset.copy+'.');}catch{form.elements[b.dataset.copy].focus();form.elements[b.dataset.copy].select();status('Press Ctrl+C to copy the selected text.');}};
$('download-pack').onclick=()=>action(downloadPack);
$('browse-tab').onclick=()=>action(async()=>{await save();view('browse');await loadInventory();});
$('queue-tab').onclick=()=>action(async()=>{await save();await loadCatalog();await loadState();view('queue');open((current&&kept(current)?current.id:null)||queue.find(q=>kept(q)&&['ready','needs_details'].includes(q.state))?.id);});
$('presets-tab').onclick=()=>action(async()=>{await save();view('presets');});
$('search-button').onclick=()=>action(async()=>{page=0;await loadInventory();});$('search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('search-button').click();}};
$('source').onchange=()=>action(async()=>{page=0;await loadInventory();});
$('previous-page').onclick=()=>action(async()=>{page--;await loadInventory();});$('next-page').onclick=()=>action(async()=>{page++;await loadInventory();});
$('select-page').onclick=()=>{for(const i of inventory){selected.set(i.source_kind+':'+i.source_id,i);}renderInventory();};
$('clear-selection').onclick=()=>{selected.clear();renderInventory();};
$('prepare-selected').onclick=()=>action(async()=>{
 if(!selected.size)throw Error('Choose products first.');const preset=presets.find(p=>p.id===$('batch-preset').value);
 const rows=[...selected.values()].filter(s=>s.eligible!==false&&!queue.some(q=>q.source_kind===s.source_kind&&q.source_id===s.source_id)).map(s=>({source_kind:s.source_kind,source_id:s.source_id,digest:s.digest,draft:preparedDraft(s,preset?.shipping)}));
 if(!rows.length)throw Error('The selected products are already in your queue.');const result=[];for(let i=0;i<rows.length;i+=50)result.push(...await rpc('studio_mercari_prepare',{p_rows:rows.slice(i,i+50)}));selected.clear();await loadState();renderInventory();view('queue');$('queue-filter').value='open';open(result[0].id);status(result.filter(r=>r.created).length+' products prepared. Complete any highlighted details; your queue is saved.');
});
$('apply-preset').onclick=()=>{const p=presets.find(p=>p.id===$('editor-preset').value);if(!p){status('Choose a shipping preset first.');return;}setShipping($('shipping-fields'),p.shipping);change();};
$('preset-form').onsubmit=e=>{e.preventDefault();action(async()=>{await rpc('studio_mercari_preset',{p_name:e.target.elements.name.value.trim(),p_shipping:readShipping($('preset-shipping'))});await loadState();status('Shipping preset saved. Choose it when preparing a batch or editing a listing.');});};
$('refresh-queue').onclick=()=>action(async()=>{await save();const id=current?.id;await loadCatalog();await loadState();open(id&&queue.some(q=>q.id===id&&kept(q))?id:next(null));status('Queue refreshed.');});$('queue-filter').onchange=renderQueue;
$('skip-item').onclick=()=>action(async()=>{const id=current?.id;await save();open(next(id));status('Progress saved. Next product loaded.');});
$('done-next').onclick=()=>action(async()=>{
 const url=MercariCopy.itemUrl($('listing-url').value.trim());
 if(!url)throw Error('Paste the published Mercari item link.');
 await save();
 if(!ready(current))throw Error('Choose a ready, unposted item first.');
 const id=current.id;
 if(queue.some(q=>q.id!==id&&MercariCopy.itemUrl(q.listing_url)===url))throw Error('This Mercari link is already recorded for another item in your queue.');
 await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'posted',p_url:url});
 await loadState();open(next(id));status('Posted link recorded. Next product loaded.');
});
$('mark-sold').onclick=()=>action(async()=>{await save();const id=current.id;await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'sold'});await loadState();open(next(id));status('Marked sold in your Mercari queue. Update any other live listings for this product.');});
$('cancel-item').onclick=()=>action(async()=>{const id=current.id;await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'cancel'});dirty=false;await loadState();open(next(id));status('Removed from your queue. The inventory product is preserved.');});
$('confirm-available').onclick=()=>action(async()=>{if(!current||current.source_kind!=='imported')throw Error('Choose a stale imported item first.');const id=current.id;await rpc('studio_mercari_confirm_available',{p_kind:current.source_kind,p_id:current.source_id,p_reason:'Seller physically confirmed item is still in stock'});inventoryCache.clear();await loadState();await loadInventory();open(id);status('Availability confirmed for seven days. Complete any remaining listing details.');});
$('confirm-identity').onclick=()=>action(async()=>{const link=current?.source_snapshot?.physical_link;if(!link||link.status!=='candidate')throw Error('No duplicate candidate is open.');await rpc('studio_mercari_links',{p_action:'confirm',p_link:link.id});inventoryCache.clear();await loadState();await loadInventory();open(current?.id);status('The two source records are now linked to one physical item. No history was deleted.');});
$('reject-identity').onclick=()=>action(async()=>{const link=current?.source_snapshot?.physical_link;if(!link||link.status!=='candidate')throw Error('No duplicate candidate is open.');await rpc('studio_mercari_links',{p_action:'reject',p_link:link.id});inventoryCache.clear();await loadState();await loadInventory();open(current?.id);status('Marked as different physical items. This pair will not be suggested again.');});
$('rebuild').onclick=()=>action(async()=>{
 const id=current.id,kind=current.source_kind,sourceId=current.source_id,shipping=readShipping($('shipping-fields')),savedPrice=form.elements.price.value.trim();
 const found=await rpc('studio_mercari_inventory',{p_kind:kind,p_query:'',p_offset:0,p_limit:200});let source=found.items.find(s=>s.source_id===sourceId);
 for(let offset=200;!source&&offset<found.total;offset+=200){const more=await rpc('studio_mercari_inventory',{p_kind:kind,p_offset:offset,p_limit:200});source=more.items.find(s=>s.source_id===sourceId);}
 if(!source)throw Error('Product no longer available in inventory.');
 const rebuilt=MercariCopy.prepare(source,shipping);rebuilt.price=savedPrice;
 await rpc('studio_mercari_update',{p_id:id,p_revision:current.revision,p_action:'rebuild',p_draft:rebuilt});dirty=false;await loadState();open(id);status('Mercari draft rebuilt from the latest source. Your price and shipping details were preserved.');
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){sessionEpoch++;clearPhotos();queue=[];inventory=[];presets=[];selected.clear();current=null;dirty=false;$('workspace').hidden=true;$('login-note').hidden=false;for(const id of ['inventory','queue-list','photos','presets-list'])$(id).replaceChildren();status('Signed out. Sign in to use your private queue.');}});
async function initialize(){await auth.initialize();const {data}=await auth.getSession();if(!data.session){$('login-note').hidden=false;status('Sign in with your existing Studio account.');return;}await loadState();await loadCatalog();$('catalog-view').value=catalog.enabled?'kept':'all';await loadCategories();await loadInventory();$('login-note').hidden=true;$('workspace').hidden=false;const requested=new URLSearchParams(location.search).get('queue');
 status('Choose products to prepare, or continue your saved Mercari queue.');
 if(requested&&queue.some(item=>item.id===requested)){view('queue');open(requested);}
 else{view('browse');if(requested)status('This queue item is no longer available.');}
}
$('retry-login').onclick=()=>action(initialize);
shippingFields($('preset-shipping'),MercariCopy.shipping());action(initialize);

function suggestCategory(source){
 const f=source.fields||{},title=String(f.title||source.suggestions?.title||'').toLowerCase();
 const groups=[
  [/smartburner|electric coil|stove burner/,['kitchen burners']], [/air fryer/,['air fryers']], [/microwave/,['microwave ovens','microwaves']], [/juicer/,['juicers']], [/blender/,['blenders']], [/coffee maker|espresso|nespresso/,['coffee makers','espresso machines']], [/bar stool/,['bar stools']], [/cat feeder|petlibro/,['cat feeders','feeding water supplies']],
  [/soundbar|sound bar/,['sound bars','soundbars']], [/preamplifier|preamp/,['preamplifiers']], [/integrated amplifier/,['integrated amplifiers']], [/receiver/,['home audio receivers']], [/subwoofer/,['home subwoofers','subwoofers']], [/amplifier/,['home audio amplifiers']], [/turntable|record player/,['turntables','record players']], [/speaker/,['home speakers']], [/headphone|earbud/,['headphones']],
  [/air conditioner|dehumidifier|humidifier|air purifier|space heater|tower fan/,['heating cooling','air conditioners','air quality','home appliances']],
  [/smartburner|stove|cooktop|burner|microwave|oven|air fryer|juicer|blender|mixer|coffee|espresso|frother|toaster|rice cooker|food processor/,['kitchen appliances','small kitchen appliances']],
  [/vacuum|roomba|carpet cleaner|steam mop/,['vacuums','floor care','vacuum cleaners','cleaning appliances']],
  [/cat feeder|dog feeder|petlibro|pet feeder|pet dryer|neakasa|cat water|pet fountain/,['pet supplies','pets']],
  [/drill|impact driver|circular saw|miter saw|sander|grinder|power tool/,['power tools','tools']],
  [/cabinet|vanity|faucet|flooring|stair nose|sink|toilet/,['home improvement','hardware','building supplies']],
  [/sofa|sectional|loveseat|recliner|chair|desk|dresser|chest|tv stand|tv cart|bookcase|ottoman|bed frame|mattress/,['furniture']],
  [/pillow|comforter|duvet|quilt|sheet set|bedding/,['bedding','bed pillows']],
  [/e.?bike|bicycle|trike|scooter/,['cycling','bicycles','scooters']],
  [/grill|griddle|smoker/,['grills','outdoor cooking','garden outdoors']],
  [/sleeping bag|camping|tent/,['camping hiking','sleeping bags']],
  [/arcade|game console|playstation|xbox|nintendo/,['consoles','video games consoles']],
  [/television|\btv\b/,['televisions']], [/monitor/,['monitors screens','monitors']], [/poe|network adapter|router|modem|ethernet/,['networking connectivity']], [/ipad|tablet/,['tablet accessories']], [/camera|camcorder/,['digital cameras']], [/printer/,['printers']], [/phone/,['cell phones smartphones']]
 ];
 const normalize=v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const candidates=categoryPaths.filter(p=>!/^all\b/i.test(p.at(-1)));
 for(const [pattern,words] of groups)if(pattern.test(title)){
  for(const term of words){const target=normalize(term);const hit=candidates.find(p=>normalize(p.at(-1))===target)||candidates.find(p=>normalize(p.at(-1)).includes(target));if(hit)return hit.join(' › ');}
 }
 const words=normalize(title+' '+(f.category||'')).split(' ').filter(w=>w.length>3&&!['with','brand','sealed','never','used','pack','black','white','inch','model'].includes(w));
 const scored=candidates.map(p=>({p,score:words.reduce((n,w)=>n+(normalize(p.at(-1)).split(' ').includes(w)?3:normalize(p.join(' ')).split(' ').includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score);
 return scored[0]?.score>=3?scored[0].p.join(' › '):'';
}
function preparedDraft(source,shipping){const researched=catalog.research.find(j=>itemKey(j)===itemKey(source)&&j.state==='complete'&&j.source_digest===source.digest);const packed={...MercariCopy.shipping(),...(shipping||{})};for(const k of ['weight_oz','length_in','width_in','height_in'])if(!packed[k]&&researched?.result?.shipping?.[k])packed[k]=String(researched.result.shipping[k]);const d=MercariCopy.prepare(source,packed);d.category=$('batch-category').value.trim()||suggestCategory(source)||d.category;return d;}
function setCategories(paths){categoryPaths=[...new Map([...(globalThis.MercariCategorySeed?.paths||[]),...paths].map(p=>[p.join(' › '),p])).values()];$('mercari-category-options').replaceChildren(...categoryPaths.map(p=>new Option(p.join(' › '),p.join(' › '))));$('category-count').textContent=categoryPaths.length+' category choices in '+new Set(categoryPaths.map(p=>p[0])).size+' departments · type to search';}
async function loadCategories(){try{const result=await rpc('studio_mercari_categories');setCategories(result.paths);}catch{setCategories([]);}}
$('inventory-grid').onclick=()=>{inventoryLayout='grid';$('inventory-grid').setAttribute('aria-pressed','true');$('inventory-table-view').setAttribute('aria-pressed','false');renderInventory();};
$('inventory-table-view').onclick=()=>{inventoryLayout='table';$('inventory-grid').setAttribute('aria-pressed','false');$('inventory-table-view').setAttribute('aria-pressed','true');renderInventory();};
for(const id of ['inventory-sort','inventory-status','inventory-review'])$(id).onchange=()=>{page=0;renderInventory();};

$('suggest-category').onclick=()=>{if(!current)return;const suggestion=suggestCategory({...current.source_snapshot,fields:{...current.source_snapshot.fields,title:form.elements.title.value}});if(!suggestion){status('No matching category was found. Choose the closest Mercari category for this item.');return;}form.elements.category.value=suggestion;change();status('Suggested category: '+suggestion);};

$('save-recovery').onclick=()=>action(async()=>{
 if(!current||current.source_kind!=='imported')throw Error('Choose an imported queue item first.');
 const description=$('recovery-description').value.trim(),files=[...$('recovery-photos').files];
 if(!description&&!files.length)throw Error('Add the original listing text or missing product photos first.');
 if(files.length>12||files.some(f=>f.size>16000000)||files.reduce((n,f)=>n+f.size,0)>100*1024*1024)throw Error('Use up to 12 photos, each under 16 MB and 100 MB total.');
 const id=current.id;await save();const {data,error}=await auth.getSession();if(error||!data.session)throw Error('Sign in to recover source details.');
 const session=data.session,user=session.user?.id;if(!user)throw Error('Refresh your Studio sign-in.');
 const batch=crypto.randomUUID(),manifest=[];
 for(const [i,file] of files.entries()){
  status('Recovering photo '+(i+1)+' of '+files.length+'…');const bytes=new Uint8Array(await file.arrayBuffer()),format=MercariCopy.format({},bytes),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(manifest.some(f=>f.sha===sha))continue;
  const path='incoming/'+user+'/'+batch+'/'+sha;
  const response=await fetch(backend+'/storage/v1/object/studio-originals/'+path,{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+session.access_token,'Content-Type':'image/'+format.replace('jpg','jpeg'),'x-upsert':'false'},body:bytes});
  if(!response.ok)throw Error('A private recovery photo could not be uploaded.');manifest.push({sha,bytes:bytes.length,name:file.name});
 }
 const result=await fetch(backend+'/functions/v1/studio-mercari-recovery',{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({queue_id:id,revision:current.revision,batch,files:manifest,description,condition:form.elements.condition.value})});
 const body=await result.json();if(!result.ok)throw Error(body.error||'Recovery could not be saved.');
 dirty=false;inventoryCache.delete('imported');await loadState();open(id);status('Recovered source saved with '+body.photos_added+' additional private photos. Your Mercari text and shipping were preserved.');
});

