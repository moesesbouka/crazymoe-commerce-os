// Confirm seller-reported posts and continue from the Facebook console.
(()=>{
 if(window.top!==window||window.__moeApprovedPickerVersion===2)return;
 window.__moeApprovedPickerVersion=2;
 const ROOT='__moe_approved_panel__',STUDIO='https://crazymoe-marketplace-studio.vercel.app/app/';
 document.getElementById(ROOT)?.remove();
 const message=value=>new Promise(resolve=>chrome.runtime.sendMessage(value,result=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:result||{ok:false,error:'Reload Commerce OS in chrome://extensions, then refresh this Facebook page.'})));
 const onForm=()=>/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(location.href);
 const publishControl=target=>{
  const el=target?.closest?.('button,[role="button"],input[type="submit"]');
  return el&&/^(?:publish|publish listing)$/i.test(String(el.getAttribute('aria-label')||el.value||el.textContent||'').replace(/\s+/g,' ').trim());
 };
 addEventListener('click',event=>{
  if(event.isTrusted||!document.documentElement.hasAttribute('data-crazymoe-cloud-review-only')||!publishControl(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();
 },true);
 let creating=false;
 const create=async()=>{
  if(creating||document.getElementById(ROOT)||document.getElementById('__moe_account_queue__'))return;
  if(!/^https:\/\/(www|m)\.facebook\.com\/marketplace(?:\/|[?#]|$)/.test(location.href))return;
  creating=true;
  const initial=await message({type:'STUDIO_APPROVED_CONTEXT'});creating=false;
  if(!onForm()&&!initial.context)return;
  if(document.getElementById(ROOT))return;
  const box=document.createElement('section');box.id=ROOT;
  box.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#142638;color:#fff;border:2px solid #78b9ec;border-radius:12px;padding:14px;width:355px;max-width:calc(100vw - 36px);max-height:75vh;overflow:auto;box-sizing:border-box;font:13px Arial;box-shadow:0 4px 20px #0009';
  const title=document.createElement('strong');title.textContent="Crazy Moe’s approved listings";box.append(title);
  const current=document.createElement('p');current.style.cssText='line-height:1.4;font-weight:bold;overflow-wrap:anywhere';box.append(current);
  const status=document.createElement('p');status.id='__moe_approved_status__';status.setAttribute('role','status');status.style.cssText='line-height:1.45;white-space:pre-wrap';box.append(status);
  const button=label=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='padding:10px;margin:4px 5px 4px 0;background:#23608a;color:white;border:1px solid #82bde9;border-radius:7px;cursor:pointer';box.append(b);return b;};
  const confirm=button('Confirm posted & load next'),next=button('Open next approved product'),retry=button('Retry on new form');
  confirm.style.background='#23704b';
  const detail=document.createElement('details');detail.open=true;const summary=document.createElement('summary');summary.textContent='Approved products';summary.style.cssText='cursor:pointer;padding:4px 0';detail.append(summary);box.append(detail);
  const select=document.createElement('select');select.id='__moe_approved_choice__';select.setAttribute('aria-label','Approved product');select.size=5;select.style.cssText='width:100%;margin:8px 0;background:#fff;color:#142638;border:1px solid #82bde9;border-radius:6px;padding:5px;font:13px Arial';detail.append(select);
  const info=document.createElement('p');info.style.cssText='line-height:1.4;margin:8px 0;overflow-wrap:anywhere';detail.append(info);
  const load=button('Load selected product'),already=button('Already listed & load next'),refresh=button('Refresh approved'),opened=button('Load opened Studio draft'),connect=button('Open Studio / sign in');opened.hidden=true;
  const hint=document.createElement('p');hint.textContent='Publish on Facebook first, then confirm above. Already listed marks the selected product as posted. The next draft opens automatically.';hint.style.cssText='font-size:12px;line-height:1.4;color:#c5dae8;margin-bottom:0';box.append(hint);
  let items=[],busy=false,context=initial.context||null,contextKey='';
  detail.open=!context;
  const controls=()=>{
   const assigned=Boolean(context),loading=context?.phase==='loading';
   load.hidden=assigned||!onForm();already.hidden=assigned||!onForm();opened.hidden=assigned||!opened.dataset.cloud||!onForm();
   load.disabled=busy||!select.value;already.disabled=busy||!select.value;
   refresh.disabled=busy||loading;select.disabled=busy||assigned;opened.disabled=busy;
   confirm.hidden=context?.phase!=='loaded';confirm.disabled=busy;
   next.hidden=context?.phase!=='confirmed'||context.done;next.disabled=busy;
   retry.hidden=context?.phase!=='error';retry.disabled=busy;
   current.textContent=context?((context.phase==='confirmed'?'Marked as listed: ':'Current product: ')+context.title):'';
  };
  const describe=()=>{
   if(!context)return;
   if(context.phase==='loaded')status.textContent='Loaded '+context.title+' with '+context.photo_count+' photos. Review category and pickup location, then publish on Facebook. After it posts, click Confirm posted & load next.';
   if(context.phase==='loading')status.textContent='Opening the next approved product and loading its details and photos…';
   if(context.phase==='error')status.textContent='Not fully loaded: '+context.error+' Your current form is preserved. Retry opens a new blank form.';
   if(context.phase==='confirmed')status.textContent=context.done?'All approved products are marked as listed. Queue finished.':context.waiting?'Your confirmation is saved. The remaining products already have open draft tabs.':context.nextTabId?'Your confirmation is saved. The next product is open in another Facebook tab.':'Your confirmation is saved. Open the next approved product to continue.';
   if(['loaded','loading','error'].includes(context.phase))document.documentElement.setAttribute('data-crazymoe-cloud-review-only','1');
   if(context.phase==='loaded')document.documentElement.setAttribute('data-crazymoe-import-owner','studio-approved');
  };
  const syncContext=async(force=false)=>{
   const result=await message({type:'STUDIO_APPROVED_CONTEXT'});if(!result.ok)return;
   const key=JSON.stringify(result.context);
   if(force||key!==contextKey){if(context?.phase!==result.context?.phase)detail.open=!result.context;contextKey=key;context=result.context;describe();controls();}
  };
  select.onchange=()=>{const item=items.find(x=>x.id===select.value);info.textContent=item?item.title+' · '+(item.price===null?'Price missing':'$'+item.price)+' · '+item.condition+' · '+item.photo_count+' photos':'';controls();};
  connect.onclick=()=>window.open(STUDIO,'_blank','noopener');
  const reload=async()=>{
   if(busy)return;busy=true;controls();
   if(!context)status.textContent='Loading approved products from Studio…';
   try{
    await syncContext();
    if(onForm()){const mode=await message({type:'STUDIO_TRANSFER_MODE'});opened.dataset.cloud=mode?.cloud?'1':'';}
    const result=await message({type:'STUDIO_APPROVED_LIST'});
    if(!result.ok)throw Error(result.error||'Studio connection unavailable');
    const prior=select.value;items=result.items||[];select.replaceChildren();
    for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;option.title=item.title;select.append(option);}
    select.value=items.some(x=>x.id===prior)?prior:'';
    summary.textContent=items.length+' approved product'+(items.length===1?'':'s');
    if(!context)status.textContent=items.length?'Connected to Studio. Choose a product below.':'Connected to Studio. No approved products are currently available.';
    else describe();select.onchange();
   }catch(error){items=[];select.replaceChildren();info.textContent='';summary.textContent='Studio connection needed';status.textContent=String(error.message)+' Open Studio and sign in in this Chrome profile, then click Refresh approved. No pairing code is needed.';}
   finally{busy=false;controls();}
  };
  const fill=async(useOpened=false)=>{
   if(busy)return;const item=items.find(x=>x.id===select.value);if(!useOpened&&!item)return;
   busy=true;controls();status.textContent='Loading approved details and verified photos…';
   document.documentElement.setAttribute('data-crazymoe-cloud-review-only','1');
   try{
    const result=await message(useOpened?{type:'STUDIO_NGK_FILL'}:{type:'STUDIO_APPROVED_SELECT',id:item.id,revision:item.revision});
    await syncContext(true);
    if(!result.ok)throw Error(result.error||'The approved draft could not be loaded');
   }catch(error){status.textContent='Not loaded: '+String(error.message);}
   finally{busy=false;controls();}
  };
  const advance=async type=>{
   if(busy)return;const item=items.find(x=>x.id===select.value);
   busy=true;controls();status.textContent=type==='STUDIO_APPROVED_CONFIRM'||type==='STUDIO_APPROVED_ALREADY'?'Saving your posted confirmation and opening the next product…':'Opening the next Facebook form…';
   try{
    const result=await message({type,...(type==='STUDIO_APPROVED_ALREADY'?{id:item?.id,revision:item?.revision}:{})});
    await syncContext(true);
    if(context?.phase==='confirmed'){
     items=items.filter(x=>x.id!==context.id);
     for(const option of [...select.options])if(option.value===context.id)option.remove();
     summary.textContent=items.length+' approved product'+(items.length===1?'':'s');select.onchange();
    }
    if(!result.ok)throw Error(result.error||'The next product could not be opened');
   }catch(error){status.textContent=String(error.message);}
   finally{busy=false;controls();}
  };
  refresh.onclick=reload;load.onclick=()=>fill();opened.onclick=()=>fill(true);
  confirm.onclick=()=>advance('STUDIO_APPROVED_CONFIRM');already.onclick=()=>advance('STUDIO_APPROVED_ALREADY');next.onclick=()=>advance('STUDIO_APPROVED_NEXT');retry.onclick=()=>advance('STUDIO_APPROVED_RETRY');
  document.documentElement.append(box);controls();describe();reload();
  const poll=setInterval(()=>{if(!box.isConnected){clearInterval(poll);return;}if(!busy)void syncContext();},1500);
 };
 void create();setInterval(()=>void create(),3500);
})();
