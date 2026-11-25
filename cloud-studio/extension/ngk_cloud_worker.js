const sleepCloud=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitStudioDownload(id){
  for(let i=0;i<240;i++){
    const [row]=await chrome.downloads.search({id});
    if(row?.state==="complete"&&row.filename)return row.filename;
    if(row?.state==="interrupted"||row?.error)throw Error("Prepared photo could not be staged");
    await sleepCloud(250);
  }
  throw Error("Prepared photo staging timed out");
}
async function stageStudioPhotos(tabId,photos){
  const folder="CrazyMoe-sync/facebook-upload/"+tabId+"-"+Date.now(),rows=[];
  try{
    for(let i=0;i<photos.length;i++){
      const id=await chrome.downloads.download({url:photos[i].dataUrl,filename:folder+"/CrazyMoe_"+(i+1)+".jpg",conflictAction:"overwrite",saveAs:false});
      rows.push({id,path:await waitStudioDownload(id)});
    }
    return rows;
  }catch(error){
    for(const row of rows){try{await chrome.downloads.removeFile(row.id)}catch{}try{await chrome.downloads.erase({id:row.id})}catch{}}
    throw error;
  }
}
async function removeStagedPhotos(rows){
  for(const row of rows){try{await chrome.downloads.removeFile(row.id)}catch{}try{await chrome.downloads.erase({id:row.id})}catch{}}
}
const STUDIO_PHOTO_CLEANUP="studioPhotoCleanup:";
async function scheduleStagedPhotoCleanup(rows){
  const key=STUDIO_PHOTO_CLEANUP+crypto.randomUUID();
  await chrome.storage.local.set({[key]:rows.map(row=>({id:row.id}))});
  await chrome.alarms.create(key,{delayInMinutes:5});
}
chrome.alarms.onAlarm.addListener(alarm=>{
  if(!alarm.name.startsWith(STUDIO_PHOTO_CLEANUP))return;
  (async()=>{
    const saved=(await chrome.storage.local.get(alarm.name))[alarm.name]||[];
    await removeStagedPhotos(saved);
    await chrome.storage.local.remove(alarm.name);
  })().catch(()=>{});
});
async function setNativeFacebookPhotos(tabId,paths){
  const target={tabId};
  await chrome.debugger.attach(target,"1.3");
  try{
    const found=await chrome.debugger.sendCommand(target,"Runtime.evaluate",{
      expression:"[...document.querySelectorAll('input[type=\\\"file\\\"]')].find(e=>!e.disabled&&(!e.accept||e.accept.includes('image')))||null",
      returnByValue:false
    });
    const objectId=found?.result?.objectId;
    if(!objectId)throw Error("Facebook photo control unavailable");
    await chrome.debugger.sendCommand(target,"DOM.setFileInputFiles",{files:paths,objectId});
  }finally{
    try{await chrome.debugger.detach(target)}catch{}
  }
}
async function waitFacebookFields(tabId,expected){
  for(let i=0;i<120;i++){
    const result=await chrome.scripting.executeScript({target:{tabId},func:data=>{
      const clean=value=>String(value??"").replace(/\r\n/g,"\n").trim();
      const find=label=>[...document.querySelectorAll("input,textarea")].find(e=>e.getClientRects().length&&new RegExp(label,"i").test([e.getAttribute("aria-label"),e.closest("label")?.innerText].filter(Boolean).join(" ")));
      const value=element=>clean(element?.value??element?.innerText??element?.textContent);
      const wantedPrice=clean(data.price).replace(/^\$\s*/,"").replace(/,/g,"");
      return value(find("title"))===clean(data.title)&&
        value(find("price")).replace(/[$,\s]/g,"")===wantedPrice&&
        value(find("description"))===clean(data.description??data.desc);
    },args:[expected]}).catch(()=>[]);
    if(result[0]?.result)return;
    await sleepCloud(250);
  }
  throw Error("Facebook did not retain the approved title, price, or description");
}
async function waitFacebookCondition(tabId,expected){
  for(let i=0;i<120;i++){
    const result=await chrome.scripting.executeScript({target:{tabId},func:wanted=>{
      const clean=value=>String(value||"").replace(/\s+/g," ").trim().toLowerCase();
      const controls=[...document.querySelectorAll('select,[role="combobox"]')].filter(e=>/\bcondition\b/i.test([e.getAttribute("aria-label"),e.closest("label")?.textContent,e.textContent].filter(Boolean).join(" ")));
      const controlMatch=controls.some(el=>{
        const selected=el.tagName==="SELECT"?[el.selectedOptions[0]?.textContent]:[el.innerText,el.getAttribute("aria-label")];
        return selected.some(value=>{const normalized=clean(value);return normalized===wanted||normalized.endsWith(" "+wanted);});
      });
      const optionMatch=[...document.querySelectorAll('[role="option"][aria-selected="true"]')].some(option=>clean(option.innerText||option.textContent)===wanted);
      const labeledFormMatch=clean(document.body.innerText).includes("condition "+wanted+" description");
      return controlMatch||optionMatch||labeledFormMatch;
    },args:[String(expected||"").trim().toLowerCase()]}).catch(()=>[]);
    if(result[0]?.result)return;
    await sleepCloud(250);
  }
  throw Error("Facebook did not retain the approved condition");
}
async function waitFacebookPhotoCount(tabId,expected){
  for(let i=0;i<180;i++){
    const result=await chrome.scripting.executeScript({target:{tabId},func:count=>{
      for(const e of document.querySelectorAll('[role="status"],[aria-live]')){
        const m=String(e.textContent||"").match(/(\d+)\s+photos?\s+attached/i);if(m&&Number(m[1])===count)return true;
      }
      const m=String(document.body.innerText||"").match(/Photos\s*·\s*(\d+)\s*\/\s*10/i);
      return Boolean(m&&Number(m[1])===count);
    },args:[expected]}).catch(()=>[]);
    if(result[0]?.result)return;
    await sleepCloud(250);
  }
  throw Error("Facebook did not retain the approved photo count");
}
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (studioOrigins.has(sender.origin) && message?.type === "STUDIO_CHECK_HANDOFF") reply({ready:true});
  return false;
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "STUDIO_NGK_FILL") return false;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id ||
      !/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(sender.url || "")) {
    reply({ok:false,error:"Open a Facebook item form from Studio."});
    return false;
  }
  (async () => {
    const draft = await studioCloudNext(sender.tab.id, "MOE_LOCAL_NEXT");
    if (draft?.source !== "studio") throw Error("Open a fresh approved draft from Studio.");
    const photos=draft.item.imageBlobs;
    if(!Array.isArray(photos)||!photos.length||photos.length>10)throw Error("Approved photos unavailable");
    const prepared={...draft.item,imageBlobs:[],images:[],deferPhotos:true};
    const filled = await chrome.scripting.executeScript({
      target:{tabId:sender.tab.id}, world:"ISOLATED", args:[prepared, true], func:moeFillExplicitListing
    });
    const result=filled[0]?.result||{ok:false,error:"Facebook could not verify this form."};
    if(!result.ok)return result;
    await waitFacebookFields(sender.tab.id,prepared);
    await waitFacebookCondition(sender.tab.id,prepared.condition);
    const staged=await stageStudioPhotos(sender.tab.id,photos);
    let accepted=false;
    try{
      await setNativeFacebookPhotos(sender.tab.id,staged.map(row=>row.path));
      await waitFacebookPhotoCount(sender.tab.id,photos.length);
      await scheduleStagedPhotoCleanup(staged);
      accepted=true;
      return {ok:true,photo_count:photos.length};
    }finally{
      if(!accepted)await removeStagedPhotos(staged);
    }
  })().then(reply).catch(error=>reply({ok:false,error:error.message}));
  return true;
});