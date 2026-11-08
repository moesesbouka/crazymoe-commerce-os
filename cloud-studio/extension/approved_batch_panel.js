// Cloud-approved product selector. Never changes approvals or publishes a listing.
(()=>{
 if(window.top!==window||window.__moeApprovedPickerVersion===1)return;
 window.__moeApprovedPickerVersion=1;
 const ROOT='__moe_approved_panel__',STUDIO='https://crazymoe-marketplace-studio.vercel.app/app/';
 document.getElementById(ROOT)?.remove();
 const message=value=>new Promise(resolve=>chrome.runtime.sendMessage(value,result=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:result||{ok:false,error:'Reload Commerce OS in chrome://extensions, then refresh this Facebook page.'})));
 const publishControl=target=>{
  const el=target?.closest?.('button,[role="button"],input[type="submit"]');
  return el&&/^(?:publish|publish listing)$/i.test(String(el.getAttribute('aria-label')||el.value||el.textContent||'').replace(/\s+/g,' ').trim());
 };
 addEventListener('click',event=>{
  if(event.isTrusted||!document.documentElement.hasAttribute('data-crazymoe-cloud-review-only')||!publishControl(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();
 },true);
 const create=()=>{
  if(!/^https:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(location.href)||document.getElementById(ROOT)||document.getElementById('__moe_account_queue__'))return;
  const box=document.createElement('section');box.id=ROOT;
  box.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#142638;color:#fff;border:2px solid #78b9ec;border-radius:12px;padding:14px;width:355px;max-width:calc(100vw - 36px);max-height:75vh;overflow:auto;box-sizing:border-box;font:13px Arial;box-shadow:0 4px 20px #0009';
  const title=document.createElement('strong');title.textContent="Crazy Moe’s approved listings";box.append(title);
  const status=document.createElement('p');status.id='__moe_approved_status__';status.setAttribute('role','status');status.style.cssText='line-height:1.45;white-space:pre-wrap';box.append(status);
  const detail=document.createElement('details');detail.open=true;const summary=document.createElement('summary');summary.textContent='Approved products';summary.style.cssText='cursor:pointer;padding:4px 0';detail.append(summary);box.append(detail);
  const select=document.createElement('select');select.id='__moe_approved_choice__';select.setAttribute('aria-label','Approved product');select.size=5;select.style.cssText='width:100%;margin:8px 0;background:#fff;color:#142638;border:1px solid #82bde9;border-radius:6px;padding:5px;font:13px Arial';detail.append(select);
  const info=document.createElement('p');info.style.cssText='line-height:1.4;margin:8px 0;overflow-wrap:anywhere';detail.append(info);
  const button=label=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:10px;margin:4px 5px 4px 0;background:#23608a;color:white;border:1px solid #82bde9;border-radius:7px;cursor:pointer';box.append(b);return b;};
  const load=button('Load selected product'),refresh=button('Refresh approved'),opened=button('Load opened Studio draft'),connect=button('Open Studio / sign in');opened.hidden=true;
  const hint=document.createElement('p');hint.textContent='Uses the Facebook account open here. Review the draft and click Publish yourself.';hint.style.cssText='font-size:12px;line-height:1.4;color:#c5dae8;margin-bottom:0';box.append(hint);
  let items=[],busy=false;
  const controls=()=>{load.disabled=busy||!select.value;refresh.disabled=busy;select.disabled=busy;opened.disabled=busy;};
  select.onchange=()=>{const item=items.find(x=>x.id===select.value);info.textContent=item?item.title+' · '+(item.price===null?'Price missing':'$'+item.price)+' · '+item.condition+' · '+item.photo_count+' photos':'';controls();};
  connect.onclick=()=>window.open(STUDIO,'_blank','noopener');
  const reload=async()=>{
   if(busy)return;busy=true;controls();status.textContent='Loading approved products from Studio…';
   try{
    const mode=await message({type:'STUDIO_TRANSFER_MODE'});opened.hidden=!mode?.cloud;
    const result=await message({type:'STUDIO_APPROVED_LIST'});
    if(!result.ok)throw Error(result.error||'Studio connection unavailable');
    const prior=select.value;items=result.items||[];select.replaceChildren();
    for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;option.title=item.title;select.append(option);}
    select.value=items.some(x=>x.id===prior)?prior:'';
    summary.textContent=items.length+' approved product'+(items.length===1?'':'s');
    status.textContent=items.length?'Connected to Studio. Choose a product below.':'Connected to Studio. No approved products are currently available.';
    select.onchange();
   }catch(error){items=[];select.replaceChildren();info.textContent='';summary.textContent='Studio connection needed';status.textContent=String(error.message)+' Open Studio and sign in in this Chrome profile, then click Refresh approved. No pairing code is needed.';}
   finally{busy=false;controls();}
  };
  const fill=async(useOpened=false)=>{
   if(busy)return;const item=items.find(x=>x.id===select.value);if(!useOpened&&!item)return;
   busy=true;controls();status.textContent='Loading approved details and verified photos…';
   document.documentElement.setAttribute('data-crazymoe-cloud-review-only','1');
   try{
    const result=await message(useOpened?{type:'STUDIO_NGK_FILL'}:{type:'STUDIO_APPROVED_SELECT',id:item.id,revision:item.revision});
    if(!result.ok)throw Error(result.error||'The approved draft could not be loaded');
    document.documentElement.setAttribute('data-crazymoe-import-owner','studio-approved');
    status.textContent='Loaded '+(result.title||item?.title||'approved product')+' with '+result.photo_count+' photos. Review category and pickup location, then publish on Facebook. Open a new blank item form for another product.';
   }catch(error){status.textContent='Not loaded: '+String(error.message);}
   finally{busy=false;controls();}
  };
  refresh.onclick=reload;load.onclick=()=>fill();opened.onclick=()=>fill(true);
  document.documentElement.append(box);reload();
 };
 create();setInterval(create,3500);
})();
