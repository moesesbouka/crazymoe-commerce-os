"use strict";
const studioOrigins=new Set(["https://crazymoe-marketplace-studio.vercel.app","https://studio.crazymoe.com"]);
const handoffRoot="https://sfheqjnxlkygjfohoybo.supabase.co";
chrome.runtime.onMessageExternal.addListener((message,sender,reply)=>{
  if (!studioOrigins.has(sender.origin) || message?.type!=="STUDIO_APPROVED_DRAFT" || !/^[a-f0-9]{64}$/.test(message.token)) return false;
  (async()=>{
    const tab=await chrome.tabs.create({url:"about:blank"});
    await chrome.storage.session.set({["studioDraft"+tab.id]:message.token});
    await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/marketplace/create/item"});
    return {ok:true};
  })().then(reply).catch(()=>reply({ok:false,error:"Unable to open Facebook draft"}));
  return true;
});
chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove("studioDraft"+id);});
// Report only whether this tab is assigned to a Studio transfer. The token stays in the worker.
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type!=="STUDIO_TRANSFER_MODE") return false;
  const url=new URL(sender.url || "about:blank");
  if(sender.frameId!==0 || !sender.tab?.id || !["https://www.facebook.com","https://m.facebook.com"].includes(url.origin)
     || !url.pathname.startsWith("/marketplace/create/")) {reply({ok:false});return false;}
  const key="studioDraft"+sender.tab.id;
  chrome.storage.session.get(key).then(state=>reply({ok:true,cloud:Boolean(state[key])})).catch(()=>reply({ok:false}));
  return true;
});
async function studioCloudNext(tabId,action){
  const key="studioDraft"+tabId;
  const token=(await chrome.storage.session.get(key))[key];
  if (!token) return null;
  if (action!=="MOE_LOCAL_NEXT" || token==="claimed") throw Error("Open a fresh transfer from Studio for this product.");
  await chrome.storage.session.set({[key]:"claimed"});
  const response=await fetch(handoffRoot+"/functions/v1/studio-handoff",{method:"POST",headers:{Authorization:"Bearer "+token},cache:"no-store"});
  if(!response.ok)throw Error("Transfer expired or listing changed. Reopen it from Studio.");
  const {item,urls}=await response.json(),imageBlobs=[];
  if(!Array.isArray(urls)||urls.length!==item.images.length||urls.length<1||urls.length>10)throw Error("Invalid photo set");
  let total=0;
  for(const [i,url] of urls.entries()){
    if(new URL(url).origin!==handoffRoot)throw Error("Invalid photo host");
    const photo=await fetch(url,{cache:"no-store",credentials:"omit"});
    if(!photo.ok)throw Error("JPEG download failed");
    const bytes=new Uint8Array(await photo.arrayBuffer());
    total+=bytes.length;
    const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
    if(bytes[0]!==255||bytes[1]!==216||bytes.length!==item.images[i].bytes||sha!==item.images[i].sha||total>35*1024*1024)throw Error("JPEG differs from approval");
    let binary="";
    for(let j=0;j<bytes.length;j+=8192)binary+=String.fromCharCode(...bytes.subarray(j,j+8192));
    imageBlobs.push({dataUrl:"data:image/jpeg;base64,"+btoa(binary),mimeType:"image/jpeg",name:"CrazyMoe_"+(i+1)+".jpg"});
  }
  return {ok:true,source:"studio",empty:false,batch_id:"cloud-"+item.id+"-"+item.revision,item:{...item,item_id:item.id,imageBlobs}};
}
