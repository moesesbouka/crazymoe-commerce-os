"use strict";
const studioOrigins=new Set(["https://crazymoe-marketplace-studio.vercel.app","https://studio.crazymoe.com"]);
const handoffRoot="https://sfheqjnxlkygjfohoybo.supabase.co";
const studioPublicKey="sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
function validStudioSession(value, fresh=false){
  return value && typeof value.access_token==="string" && value.access_token.split(".").length===3 &&
    value.access_token.length<4096 && typeof value.refresh_token==="string" &&
    value.refresh_token.length>=8 && value.refresh_token.length<1024 &&
    Number.isFinite(Number(value.expires_at)) && Number(value.expires_at)>0 &&
    (!fresh || Number(value.expires_at)>Date.now()/1000-120) && Number(value.expires_at)<Date.now()/1000+86400;
}
async function rememberStudioSession(value,fresh=true){
  if(!validStudioSession(value,fresh))throw Error("Invalid Studio session");
  const session={access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Number(value.expires_at)};
  await chrome.storage.session.set({studioAuthSession:session});
  return session;
}
const readStudioSession=async()=>(await chrome.storage.session.get("studioAuthSession")).studioAuthSession;
let studioConnectFlight=null,studioTokenFlight=null;
async function reconnectStudio(){
  if(studioConnectFlight)return studioConnectFlight;
  studioConnectFlight=(async()=>{
    const probe=async tab=>{
      if(!tab?.id || !studioOrigins.has(new URL(tab.url||"about:blank").origin))return null;
      try{
        const result=await chrome.scripting.executeScript({
          target:{tabId:tab.id},world:"MAIN",
          func:()=>{
            if(!["https://crazymoe-marketplace-studio.vercel.app","https://studio.crazymoe.com"].includes(location.origin))return null;
            try{
              const value=JSON.parse(localStorage.getItem("crazymoe-studio-auth")||"null");
              return value&&{access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at};
            }catch{return null;}
          }
        });
        const session=result?.[0]?.result;
        if(validStudioSession(session))return rememberStudioSession(session,false);
        await chrome.tabs.update(tab.id,{active:true});
        throw Error("Sign in to the Studio tab, then click Refresh approved.");
      }catch(error){if(String(error.message).startsWith("Sign in to"))throw error;}
      return null;
    };
    const tabs=await chrome.tabs.query({url:[...studioOrigins].map(origin=>origin+"/*")});
    for(const tab of tabs.sort((a,b)=>Number(b.active)-Number(a.active))){const session=await probe(tab);if(session)return session;}
    // A fresh tab obtains current app code without refreshing an editor with unsaved changes.
    const opened=await chrome.tabs.create({url:"https://crazymoe-marketplace-studio.vercel.app/app/",active:false});
    for(let attempt=0;attempt<40;attempt++){
      const tab=await chrome.tabs.get(opened.id);
      if(tab.status==="complete"){const session=await probe(tab);if(session)return session;break;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await chrome.tabs.update(opened.id,{active:true});
    throw Error("Studio could not connect yet. Finish signing in in the Studio tab, then click Refresh approved.");
  })();
  try{return await studioConnectFlight;}finally{studioConnectFlight=null;}
}
async function studioMemberToken(){
  const existing=await readStudioSession();
  if(validStudioSession(existing)&&existing.expires_at>Date.now()/1000+45)return existing.access_token;
  if(studioTokenFlight)return studioTokenFlight;
  studioTokenFlight=(async()=>{
    let session=await readStudioSession();
    if(!validStudioSession(session))session=await reconnectStudio();
    if(session.expires_at>Date.now()/1000+45)return session.access_token;
    // Expired access tokens still have usable refresh tokens; serialize token rotation.
    const response=await fetch(handoffRoot+"/auth/v1/token?grant_type=refresh_token",{
      method:"POST",headers:{apikey:studioPublicKey,"Content-Type":"application/json"},
      body:JSON.stringify({refresh_token:session.refresh_token}),cache:"no-store"
    });
    if(response.ok)return (await rememberStudioSession(await response.json())).access_token;
    if(response.status>=500)throw Error("Studio is temporarily unavailable. Try Refresh approved again.");
    const current=await readStudioSession();
    if(current?.refresh_token!==session.refresh_token&&validStudioSession(current,true))return current.access_token;
    await chrome.storage.session.remove("studioAuthSession");
    return (await reconnectStudio()).access_token;
  })();
  try{return await studioTokenFlight;}finally{studioTokenFlight=null;}
}
async function studioMemberFetch(input,options={}){
  const url=new URL(input,handoffRoot);
  if(url.origin!==handoffRoot)throw Error("Invalid Studio API host");
  const token=await studioMemberToken();
  return fetch(url.href,{...options,cache:"no-store",headers:{...(options.headers||{}),apikey:studioPublicKey,Authorization:"Bearer "+token}});
}
chrome.runtime.onMessageExternal.addListener((message,sender,reply)=>{
  if(!studioOrigins.has(sender.origin))return false;
  if(message?.type==="STUDIO_AUTH_SESSION"){
    rememberStudioSession(message.session).then(()=>reply({ok:true})).catch(()=>reply({ok:false,error:"Invalid Studio session"}));
    return true;
  }
  if(message?.type!=="STUDIO_APPROVED_DRAFT" || !/^[a-f0-9]{64}$/.test(message.token))return false;
  (async()=>{
    if(message.session)await rememberStudioSession(message.session);
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
  if(message?.type==="STUDIO_AUTH_SESSION"){
    const origin=new URL(sender.url||"about:blank").origin;
    if(sender.id!==chrome.runtime.id||sender.frameId!==0||!sender.tab?.id||!studioOrigins.has(origin))return false;
    rememberStudioSession(message.session).then(()=>reply({ok:true})).catch(()=>reply({ok:false,error:"Invalid Studio session"}));
    return true;
  }

  if(message?.type==="STUDIO_MEMBER_PROBE"){
    if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL(""))){reply({ok:false});return false;}
    studioMemberFetch("/rest/v1/active_listings?select=facebook_id&limit=1")
      .then(async response=>reply({ok:response.ok,status:response.status,count:(await response.json()).length}))
      .catch(error=>reply({ok:false,error:error.message}));
    return true;
  }
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