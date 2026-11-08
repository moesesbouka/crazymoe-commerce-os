// Explicit, owner-controlled private approved-listing handoff. No auto-fill or publishing.
(()=>{
 if(window.top!==window||window.__moeApprovedPanelInstalled)return;
 window.__moeApprovedPanelInstalled=true;
 const ROOT="__moe_approved_panel__";
 // A Studio handoff is review-only. Block scripted Publish clicks while
 // retaining Moe's normal trusted click after he has reviewed the draft.
 const publishControl=target=>{
  const el=target?.closest?.('button,[role="button"],input[type="submit"]');
  if(!el)return null;
  const label=String(el.getAttribute("aria-label")||el.value||el.textContent||"").replace(/\s+/g," ").trim();
  return /^(?:publish|publish listing)$/i.test(label)?el:null;
 };
 addEventListener("click",event=>{
  if(event.isTrusted||!document.documentElement.hasAttribute("data-crazymoe-cloud-review-only")||!publishControl(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();
  const panel=document.getElementById(ROOT),status=panel?.querySelector("p");
  if(status)status.textContent="Automated publishing was blocked. Review the draft and click Publish yourself when ready.";
 },true);
 const create=()=> {
  if(!/^https:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/create\//.test(location.href))return;
  if(document.getElementById(ROOT))return;
  const box=document.createElement("section");box.id=ROOT;
  box.style.cssText="position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#142638;color:#fff;border:2px solid #78b9ec;border-radius:12px;padding:12px;width:315px;max-width:calc(100vw - 36px);font:13px Arial;box-shadow:0 4px 20px #0009";
  const heading=document.createElement("strong");heading.textContent="Crazy Moe's approved listings";box.append(heading);
  const status=document.createElement("p");status.textContent="Load only when you choose. Nothing publishes automatically.";status.style.cssText="line-height:1.4;white-space:pre-wrap";box.append(status);
  const button=(label)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.style.cssText="padding:9px;margin:4px 4px 4px 0;background:#23608a;color:white;border:1px solid #82bde9;border-radius:7px;cursor:pointer";box.append(b);return b;};
  const load=button("Load next approved product"),pair=button("Pair this computer"),studio=button("Open Studio");
  studio.onclick=()=>window.open("https://crazymoe-marketplace-studio.vercel.app/app/","_blank","noopener");
  pair.onclick=()=>{
   const key=prompt("Paste the one-time device pairing key generated inside your authenticated Crazy Moe Studio. Never paste it into chat.");
   if(key===null)return;
   if(!/^[A-Za-z0-9_-]{40,128}$/.test(key.trim())){status.textContent="Invalid pairing key format. Nothing saved.";return;}
   chrome.runtime.sendMessage({type:"MOE_NGK_PAIR",token:key.trim()},r=>{status.textContent=chrome.runtime.lastError?.message||r?.error||(r?.ok?"Pairing verified for this browser.":"Pairing failed.");});
  };
  load.onclick=async ()=>{
   if(load.disabled)return;
   if(document.documentElement.hasAttribute("data-crazymoe-import-owner")){status.textContent="This form received an import. Open a fresh blank item form for another product.";return;}
   const hasDraft=[...document.querySelectorAll('[role="form"][aria-label="Marketplace"] input:not([type="checkbox"]):not([type="radio"]),[role="form"][aria-label="Marketplace"] textarea')].some(x=>x.type!=="hidden"&&x.type!=="file"&&x.value?.trim())||document.querySelector('img[alt^="Listing photo"]');
   if(hasDraft){status.textContent="Use a blank Marketplace item form. Your existing draft is preserved.";return;}
   load.disabled=true;status.textContent="Retrieving approved product and prepared photos...";
   try {
    const mode=await chrome.runtime.sendMessage({type:"STUDIO_TRANSFER_MODE"});
    if(!mode?.ok)throw Error("Reopen the Facebook form from Studio.");
    if(mode.cloud){
      const result=await chrome.runtime.sendMessage({type:"STUDIO_NGK_FILL"});
      if(!result?.ok)throw Error(result?.error||"Facebook fill failed.");
      document.documentElement.setAttribute("data-crazymoe-cloud-review-only","1");
      status.textContent="Verified cloud draft. Review it on Facebook. Automated publishing is blocked.";
      load.disabled=false;return;
    }
   } catch(error){status.textContent=error.message;load.disabled=false;return;}
   chrome.runtime.sendMessage({type:"MOE_NGK_NEXT"},async r=>{
    try{
     if(chrome.runtime.lastError)throw Error(chrome.runtime.lastError.message);
     if(!r?.ok)throw Error(r?.error||"Private bridge unavailable");
     if(r.empty){status.textContent="No approved items queued. Prepare a batch in Studio.";return;}
     const filled=await chrome.runtime.sendMessage({type:"INJECT_FILL",tabId:r.tabId,data:r.item});
     if(!filled?.ok)throw Error(filled?.error||"Facebook form verification failed");
     const cursor=await chrome.runtime.sendMessage({type:"MOE_NGK_CURSOR",batch_id:r.batch_id,item_id:r.item.id}).catch(()=>null);
     if(!cursor?.ok){status.textContent="Product loaded, but the queue position could not be saved. Review this draft; do not repeat the fill.";return;}
     status.textContent="Loaded "+r.item.title+". Verify condition, category, all fields and photos. Publish manually only.";
    }catch(e){status.textContent="Not loaded: "+e.message;}finally{load.disabled=false;}
   });
  };
  document.documentElement.appendChild(box);
 };
 create();setInterval(create,3500);
})();