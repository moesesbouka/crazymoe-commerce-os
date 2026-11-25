// One explicit product per invocation; never stores or replays a payload.
async function moeFillExplicitListing(data, cloud = false) {
  if (window.__moeExplicitBusy) return {ok:false,error:"Another product is loading"};
  window.__moeExplicitBusy=true;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const text=x=>String(x??"").replace(/\r\n/g,"\n").trim();
  let badge=document.getElementById("__moe_explicit_status__");
  if(!badge){badge=document.createElement("div");badge.id="__moe_explicit_status__";badge.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483647;background:#142638;color:white;padding:12px;max-width:340px;font:13px system-ui";document.documentElement.append(badge);}
  try {
    if(!/^https:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/create\//i.test(location.href))throw Error("Open a Marketplace create form");
    if(!data||typeof data!=="object")throw Error("Missing product payload");
    const title=text(data.title),description=text(data.description??data.desc),rawPrice=text(data.price).replace(/^\$\s*/,"");
    if(!title)throw Error("Missing title");
    if(rawPrice&&!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(rawPrice))throw Error("Invalid price");
    const price=rawPrice.replace(/,/g,"");
    const find=label=>{const candidates=[...document.querySelectorAll('input:not([type="hidden"]):not([type="file"]),textarea,[contenteditable="true"]')].filter(e=>e.getClientRects().length).filter(e=>{
      const labelText=[e.getAttribute("aria-label"),e.getAttribute("placeholder"),e.getAttribute("name"),e.closest("label")?.textContent].filter(Boolean).join(" ").toLowerCase();
      return label==="title"?/\btitle\b|what are you selling|item name/.test(labelText):new RegExp("\\b"+label+"\\b").test(labelText);
    });
      if(candidates.length>1)throw Error("Multiple Facebook "+label+" fields found; open a blank item form");
      return candidates[0];
    };
    const value=e=>text(e?.value??e?.innerText??e?.textContent);
    const same=(key,desired)=>key==="price"?value(find(key)).replace(/[$,\s]/g,"")===desired:value(find(key))===desired;
    const wait=async(fn,ms=20000,message="Facebook did not retain requested values")=>{const end=Date.now()+ms;do{if(fn())return;await sleep(200);}while(Date.now()<end);throw Error(message);};
    await wait(()=>find("title")&&find("price")&&find("description"),20000,"Facebook listing fields unavailable");
    const owner="data-crazymoe-import-owner";
    if(document.documentElement.hasAttribute(owner))throw Error("This form already received an import. Open a new blank item form.");
    const hasPhotos=[...document.querySelectorAll('input[type="file"]')].some(input=>input.files?.length)||
      document.querySelector('img[alt^="Listing photo"],[aria-label^="Remove photo"],[aria-label^="Delete photo"]');
    if(hasPhotos||["title","price","description"].some(key=>value(find(key))))throw Error("Existing draft preserved. Open a blank Marketplace item form.");
    document.documentElement.setAttribute(owner,"gallery:"+crypto.randomUUID());
    badge.textContent="Loading explicit product...";
    const fields=[["title",title],["price",price],["description",description]];
    for(const [key,desired] of fields){
      const e=find(key);if(value(e))throw Error("Seller edit preserved in "+key);if(!desired)continue;e.focus();
      if(e.tagName==="INPUT"||e.tagName==="TEXTAREA"){
        const proto=e.tagName==="INPUT"?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
        const set=Object.getOwnPropertyDescriptor(proto,"value").set;
        const previous=e.value;
        set.call(e,desired);
        if(e._valueTracker)e._valueTracker.setValue(previous);
        e.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:null}));
        e.dispatchEvent(new Event("change",{bubbles:true}));
      }else{
        const selection=getSelection(),range=document.createRange();range.selectNodeContents(e);selection.removeAllRanges();selection.addRange(range);
        document.execCommand("insertText",false,desired);
      }
      e.blur();if(!(cloud&&data.deferPhotos))await wait(()=>same(key,desired),20000,"Facebook did not retain "+key);
    }
    const conditionControls=()=>[...document.querySelectorAll('select,[role="combobox"]')]
      .filter(e=>e.getClientRects().length&&/\bcondition\b/i.test([e.getAttribute("aria-label"),e.closest("label")?.textContent,e.textContent].filter(Boolean).join(" ")));
    const conditionMatches=()=>{
      const controls=conditionControls();
      if(controls.length!==1)return false;
      const el=controls[0], selected=el.tagName==="SELECT"?[el.selectedOptions[0]?.textContent]:[el.innerText,el.getAttribute("aria-label")];
      const wanted=text(data.condition).toLowerCase();
      const controlMatch=selected.some(s=>{const normalized=text(s).replace(/\s+/g," ").toLowerCase();return normalized===wanted||normalized.endsWith(" "+wanted);});
      const selectedOptionMatch=[...document.querySelectorAll('[role="option"][aria-selected="true"]')].some(o=>text(o.innerText||o.textContent).replace(/\s+/g," ").toLowerCase()===wanted);
      return controlMatch||selectedOptionMatch;
    };
    if(cloud&&!conditionMatches()){
      const controls=conditionControls();
      if(!text(data.condition)||controls.length!==1)throw Error("Review the Facebook condition control.");
      const el=controls[0];
      if(el.tagName==="SELECT"){
        const options=[...el.options].filter(o=>text(o.textContent).toLowerCase()===text(data.condition).toLowerCase());
        if(options.length!==1)throw Error("Facebook condition unavailable.");
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,options[0].value);
        el.dispatchEvent(new Event("change",{bubbles:true}));
      }else{
        el.click();
        const options=()=>[...document.querySelectorAll('[role="option"]')].filter(o=>o.getClientRects().length&&text(o.innerText).toLowerCase()===text(data.condition).toLowerCase());
        await wait(()=>options().length===1,20000,"Facebook condition option unavailable");options()[0].click();
      }
      if(!(cloud&&data.deferPhotos))await wait(conditionMatches,20000,"Facebook did not retain approved condition");
    }
    const source=Array.isArray(data.imageBlobs)&&data.imageBlobs.length?data.imageBlobs:Array.isArray(data.images)?data.images:[];
    if(source.length>10)throw Error("Choose at most 10 photos");
    if(source.length){
      const files=[];
      for(let i=0;i<source.length;i++){
        const item=source[i],url=typeof item==="string"?item:item.dataUrl;
        if(!url||!/^data:image\//i.test(url))throw Error("Photo "+(i+1)+" needs image data; URL-only photos were not transferred");
        const response=await fetch(url),blob=await response.blob();if(!blob.type.startsWith("image/"))throw Error("Invalid photo data");
        files.push(new File([blob],typeof item==="object"&&item.name||"product-"+i+".jpg",{type:blob.type}));
      }
      const inputs=[...document.querySelectorAll('input[type="file"]')].filter(e=>!e.disabled&&(!e.accept||e.accept.includes("image")));
      if(inputs.length!==1)throw Error("A single Facebook photo upload field could not be identified");
      const input=inputs[0];
      if(input.files?.length||document.querySelector('img[alt^="Listing photo"],[aria-label^="Remove photo"],[aria-label^="Delete photo"]'))throw Error("Seller photo selection preserved");
      const transfer=new DataTransfer();files.forEach(f=>transfer.items.add(f));
      const attachedPhotoCount=()=>{
        for(const el of document.querySelectorAll('[role="status"],[aria-live]')){
          const match=text(el.textContent).match(/(\d+)\s+photos?\s+attached/i);if(match)return Number(match[1]);
        }
        const match=text(document.body.innerText).match(/Photos\s*·\s*(\d+)\s*\/\s*10/i);
        return match?Number(match[1]):0;
      };
      const selectFiles=()=>{input.files=transfer.files;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));};
      selectFiles();
      try{await wait(()=>attachedPhotoCount()===files.length,12000,"Facebook did not accept the prepared photo selection");}
      catch{
        input.files=transfer.files;
        for(const kind of ["dragenter","dragover","drop"])input.dispatchEvent(new DragEvent(kind,{bubbles:true,cancelable:true,dataTransfer:transfer}));
        await wait(()=>attachedPhotoCount()===files.length,45000,"Facebook did not retain the prepared photos");
      }
    }
    await sleep(500);if(!(cloud&&data.deferPhotos))for(const [key,desired] of fields)if(!same(key,desired))throw Error(key+" changed during upload");
    if(cloud){
      if((!data.deferPhotos&&!conditionMatches())||(!source.length&&!data.deferPhotos))throw Error("Facebook did not retain the approved condition or photos.");
      badge.textContent=data.deferPhotos?"Approved fields verified. Attaching prepared photos...":"Approved fields and photo count verified. Review the Facebook draft.";
      return {ok:true,photo_count:source.length,deferred_photos:Boolean(data.deferPhotos)};
    }
    const checks=["category","condition","photo order"];if(!price)checks.push("price");if(!description)checks.push("description");if(!source.length)checks.push("photos");
    badge.textContent="Product text verified. Check "+checks.join(", ")+". Nothing published.";
    return {ok:true,partial:true,manual_checks:checks,photo_count:source.length};
  }catch(error){badge.textContent="Not verified: "+error.message;return {ok:false,error:error.message};}
  finally{window.__moeExplicitBusy=false;}
}