'use strict';
const $=id=>document.getElementById(id),auth=studioAuth.auth;
const backend='https://sfheqjnxlkygjfohoybo.supabase.co',publicKey='sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af';
let inventory=[],accounts=[],queue=[],selected=new Set(),drafts=new Map(),busy=false;
const labels={prepared:'Prepared',filling:'Loading Facebook',filled:'Draft filled',submitted:'Publication recorded',live:'Confirmed live',error:'Needs attention',stale:'Source changed',cancelled:'Cancelled',remove_needed:'Remove other listing'};
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const status=text=>{$('status').textContent=text;};
async function rpc(name,args={}){
 const {data,error}=await auth.getSession();if(error||!data.session)throw Error('Sign in to Studio to continue.');
 const response=await fetch(backend+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',headers:{apikey:publicKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});
 const body=await response.json();if(!response.ok)throw Error(body.message||body.error||'Request failed');return body;
}
async function action(fn){if(busy)return;busy=true;try{await fn();}catch(error){status(error.message);}finally{busy=false;}}
function show(view){for(const key of ['browse','preview','queue']){$(key+'-view').hidden=key!==view;$(key+'-tab').classList.toggle('active',key===view);}}
function destination(){return accounts.find(a=>a.id===$('destination').value);}
function existing(item){return item.copies?.find(c=>c.account_id===$('destination').value&&!['cancelled','error','stale','prepared'].includes(c.state));}
function visible(){const q=$('search').value.trim().toLowerCase(),cat=$('category').value;return inventory.filter(i=>(!q||(i.title+' '+(i.category||'')).toLowerCase().includes(q))&&(!cat||(i.category||'Uncategorized')===cat));}
function renderInventory(){
 const rows=visible();$('inventory').replaceChildren();
 for(const item of rows){
  const card=el('article',undefined,'product'+(selected.has(item.id)?' selected':''));
  const img=el('img');img.alt=item.title;img.loading='lazy';img.referrerPolicy='no-referrer';
  const photo=item.images?.find(x=>typeof x==='string'&&x.startsWith(PostingCopy.photoRoot));if(photo)img.src=photo;else img.hidden=true;
  const label=el('label'),input=el('input');input.type='checkbox';input.checked=selected.has(item.id);
  const issues=PostingCopy.issues(item);if(existing(item))issues.push('Already in destination workflow');
  input.disabled=Boolean(issues.length);input.setAttribute('aria-label','Select '+item.title);
  input.onchange=()=>{if(input.checked&&selected.size>=50){input.checked=false;status('Select up to 50 products in one batch.');return;}if(input.checked)selected.add(item.id);else{selected.delete(item.id);drafts.delete(item.id);}card.classList.toggle('selected',input.checked);updateCounts();};
  label.append(input,el('span',item.title));card.append(img,label,el('p',issues.length?issues.join(' · '):'$'+item.price+' · '+item.condition+' · '+(item.images?.length||0)+' photos','meta'+(issues.length?' problem':'')));$('inventory').append(card);
 }
 $('inventory-summary').textContent=rows.length+' of '+inventory.length+' recorded active products · '+selected.size+' selected · incomplete products are marked below.';updateCounts();
}
function updateCounts(){$('selection-count').textContent=selected.size;$('queue-count').textContent=queue.filter(c=>c.state!=='cancelled').length;}
function renderAccounts(){const previous=$('destination').value;$('destination').replaceChildren(new Option('Choose an account…',''),...accounts.map(a=>new Option(a.label,a.id)));if(accounts.some(a=>a.id===previous))$('destination').value=previous;else if(accounts.length===1)$('destination').value=accounts[0].id;}
function renderPreviews(){
 $('previews').replaceChildren();
 for(const id of selected){const item=inventory.find(i=>i.id===id);if(!item)continue;
  let draft=drafts.get(id);if(!draft){draft=PostingCopy.refreshCopy(item);drafts.set(id,draft);}
  const card=el('article',undefined,'preview');card.append(el('h3',item.title));
  const grid=el('div',undefined,'copy-grid'),left=el('div'),right=el('div');
  const titleLabel=el('label','Fresh title'),titleInput=el('input');titleInput.value=draft.title;titleInput.maxLength=150;titleInput.oninput=()=>draft.title=titleInput.value;titleLabel.append(titleInput);
  const descLabel=el('label','Fresh description'),descInput=el('textarea');descInput.value=draft.description;descInput.maxLength=20000;descInput.oninput=()=>draft.description=descInput.value;descLabel.append(descInput);left.append(titleLabel,descLabel);
  const detail=el('details'),summary=el('summary','Compare original description');detail.append(summary,el('p',item.description,'source-copy'));right.append(detail,el('p','Price: $'+item.price+' · Condition: '+item.condition+'. These stay matched to the source.','hint'),el('p','Choose a genuine photo as the new cover. Other photos retain their order.','hint'));
  const strip=el('div',undefined,'photo-strip');
  const renderPhotos=()=>{strip.replaceChildren();draft.images.forEach((url,index)=>{const button=el('button',undefined,'photo-choice'+(index===0?' cover':''));button.type='button';const image=el('img');image.src=url;image.alt='Product photo '+(index+1);image.loading='lazy';image.referrerPolicy='no-referrer';button.append(image,el('span',index===0?'Cover':'Make cover'));button.onclick=()=>{draft.images.splice(index,1);draft.images.unshift(url);renderPhotos();};strip.append(button);});};renderPhotos();right.append(strip);
  const remove=el('button','Remove from batch','secondary');remove.onclick=()=>{selected.delete(id);drafts.delete(id);renderPreviews();renderInventory();};right.append(remove);grid.append(left,right);card.append(grid);$('previews').append(card);
 }
 if(!selected.size)$('previews').append(el('p','Select products to prepare a batch.','hint'));
 updateCounts();
}
async function extension(){
 if(!globalThis.chrome?.runtime?.sendMessage)throw Error('Open this page in desktop Chrome with Commerce OS enabled.');
 for(const id of ['jhkkefonggnemmdpaahpnkgcgfjibeal','kbdeepgfbofgljhijkdejmodfhfeeplh']){
  const answer=await chrome.runtime.sendMessage(id,{type:'STUDIO_ACCOUNT_QUEUE_CHECK'}).catch(()=>null);if(answer?.ready)return id;
 }throw Error('Reload the updated Commerce OS extension in chrome://extensions, then refresh this page.');
}
async function start(copy){
 const ext=await extension();const transfer=await rpc('studio_posting_claim',{p_id:copy.id,p_revision:copy.revision});
 status('Opening '+copy.account_label+'’s Facebook draft. The account and current availability will be checked before filling.');
 try{const result=await chrome.runtime.sendMessage(ext,{type:'STUDIO_ACCOUNT_QUEUE_FILL',token:transfer.token});if(!result?.ok)throw Error(result?.error||'Transfer interrupted; refresh status before retrying.');status('Draft filled. Review category and location, publish on Facebook, then save its new link below.');}
 finally{await loadQueue();}
}
function renderQueue(){
 $('queue').replaceChildren();const dest=$('destination').value,rows=queue.filter(c=>!dest||c.account_id===dest);
 for(const copy of rows){const card=el('article',undefined,'queue-card'),head=el('div',undefined,'queue-top');
  head.append(el('h3',copy.draft.title),el('span',labels[copy.state]||copy.state,'badge '+copy.state));card.append(head,el('p',copy.account_label+' · $'+copy.draft.price+' · '+copy.draft.condition,'hint'));
  if(copy.issue)card.append(el('p',copy.issue,'hint problem'));
  const actions=el('div',undefined,'actions');
  if(copy.state==='prepared'){const button=el('button','Open this Facebook draft','primary');button.onclick=()=>action(()=>start(copy));actions.append(button);}
  if(copy.state==='filled'||copy.state==='submitted'){
   const label=el('label','New listing URL on '+copy.account_label),input=el('input');input.type='url';input.placeholder='https://www.facebook.com/marketplace/item/…';if(copy.listing_id)input.value='https://www.facebook.com/marketplace/item/'+copy.listing_id+'/';label.append(input);
   const button=el('button','Save link','primary');button.onclick=()=>action(async()=>{await rpc('studio_posting_result',{p_id:copy.id,p_revision:copy.revision,p_action:'submitted',p_url:input.value.trim()});await loadQueue();status('Publication link saved. Use Start next product to continue. Live status awaits a destination observation.');});actions.append(label,button);
  }
  if(copy.state==='error'){const note=el('p','Check the Facebook tab for a partially filled draft before retrying. A retry opens a new form.','hint');card.append(note);const button=el('button','Retry after checking draft','secondary');button.onclick=()=>action(async()=>{await rpc('studio_posting_result',{p_id:copy.id,p_revision:copy.revision,p_action:'retry'});await loadQueue();});actions.append(button);}
  if(copy.state==='remove_needed'){const button=el('button','I marked it sold / removed it','secondary');button.onclick=()=>action(async()=>{await rpc('studio_posting_result',{p_id:copy.id,p_revision:copy.revision,p_action:'removed'});await loadQueue();});actions.append(button);}
  if(copy.listing_id){const link=el('a','Open destination listing ↗');link.href='https://www.facebook.com/marketplace/item/'+copy.listing_id+'/';link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
  if(['prepared','error','stale','filled'].includes(copy.state)){const cancel=el('button','Cancel queue item','secondary');cancel.onclick=()=>action(async()=>{await rpc('studio_posting_result',{p_id:copy.id,p_revision:copy.revision,p_action:'cancel'});await loadQueue();});actions.append(cancel);}
  card.append(actions);$('queue').append(card);
 }
 if(!rows.length)$('queue').append(el('p','No products queued for this account yet.','hint'));updateCounts();
}
async function loadQueue(){queue=await rpc('studio_posting_queue');renderQueue();}
async function loadInventory(){inventory=[];let offset=0,total=1;while(offset<total){const page=await rpc('studio_posting_inventory',{p_offset:offset,p_limit:200});inventory.push(...page.items);total=page.total;offset+=page.items.length;if(!page.items.length)break;}
 const cats=[...new Set(inventory.map(i=>i.category||'Uncategorized'))].sort();$('category').replaceChildren(new Option('All categories',''),...cats.map(c=>new Option(c,c)));renderInventory();}
$('account-form').onsubmit=event=>{event.preventDefault();action(async()=>{const profile=PostingCopy.profileId($('account-profile').value);if(!profile)throw Error('Use the numeric Facebook profile ID, or Read signed-in Facebook account after switching accounts.');accounts=await rpc('studio_posting_accounts',{p_label:$('account-name').value.trim(),p_profile:profile,p_tag:'seller_'+profile});renderAccounts();$('destination').value=accounts.find(a=>a.profile_id===profile).id;$('account-setup').open=false;renderInventory();status('Destination saved. Select the products you want to prepare.');});};
$('detect-account').onclick=()=>action(async()=>{const ext=await extension();const result=await chrome.runtime.sendMessage(ext,{type:'STUDIO_ACCOUNT_QUEUE_IDENTIFY'});if(!result?.profile_id)throw Error(result?.error||'Could not read this Facebook account.');$('account-profile').value=result.profile_id;status('Profile ID read from the signed-in Facebook account. Check its display name and save the destination.');});
$('destination').onchange=()=>{selected.clear();drafts.clear();renderInventory();renderQueue();};
$('search').oninput=renderInventory;$('category').onchange=renderInventory;
$('select-visible').onclick=()=>{for(const item of visible()){if(selected.size>=50)break;if(!PostingCopy.issues(item).length&&!existing(item))selected.add(item.id);}renderInventory();status('Selected '+selected.size+' eligible products. Each batch supports up to 50.');};
$('clear-selected').onclick=()=>{selected.clear();drafts.clear();renderInventory();};
const review=()=>{renderPreviews();show('preview');};$('review-selected').onclick=review;$('preview-tab').onclick=review;
$('browse-tab').onclick=()=>show('browse');$('queue-tab').onclick=()=>{show('queue');action(loadQueue);};
$('prepare-batch').onclick=()=>action(async()=>{if(!destination())throw Error('Add or choose the destination account first.');if(!selected.size)throw Error('Select products first.');const rows=[...selected].map(id=>({source_id:id,digest:inventory.find(i=>i.id===id).digest,draft:drafts.get(id)}));await rpc('studio_posting_prepare',{p_account:destination().id,p_rows:rows});selected.clear();drafts.clear();await loadQueue();await loadInventory();show('queue');status('Batch saved. Start next product when the destination Facebook account is signed in.');});
$('refresh-queue').onclick=()=>action(loadQueue);
$('start-queue').onclick=()=>action(async()=>{if(!destination())throw Error('Choose a destination account.');await loadQueue();const candidates=queue.filter(c=>c.account_id===destination().id);if(candidates.some(c=>['filling','filled'].includes(c.state)))throw Error('Finish the current Facebook draft and save its new listing link before starting another.');const next=candidates.filter(c=>c.state==='prepared').sort((a,b)=>a.created_at.localeCompare(b.created_at))[0];if(!next)throw Error('No prepared products for this account.');await start(next);});
auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){inventory=[];queue=[];accounts=[];selected.clear();drafts.clear();$('workspace').hidden=true;$('inventory').replaceChildren();$('queue').replaceChildren();$('previews').replaceChildren();$('login-note').hidden=false;}});
(async()=>{try{await auth.initialize();const {data}=await auth.getSession();if(!data.session){$('login-note').hidden=false;status('Sign in to use your inventory.');return;}accounts=await rpc('studio_posting_accounts');renderAccounts();await loadQueue();await loadInventory();$('workspace').hidden=false;status('Choose a destination and select available products.');}catch(error){status(error.message);}})();
