/* Account-scoped posting handoff. Publication remains an explicit Facebook action. */
'use strict';
const accountQueueEndpoint='https://sfheqjnxlkygjfohoybo.supabase.co/functions/v1/studio-account-handoff';
const accountPhotoRoot='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/';
let accountQueueBusy=false;
async function accountTransfer(token,action,evidence={}){
 const response=await fetch(accountQueueEndpoint,{method:'POST',cache:'no-store',credentials:'omit',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,evidence})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Transfer unavailable');return value;
}
// Facebook's own bootstrapped current-user module, never other sellers' profile IDs.
// If Facebook changes its shape, stop without filling a form.
function accountCurrentSeller(){
 const ids=new Set();
 for(const script of document.querySelectorAll('script')){
  const text=script.textContent||'';if(!text.includes('CurrentUserInitialData'))continue;
  const expression=/\[\s*"CurrentUserInitialData"\s*,\s*\[\s*\]\s*,\s*(\{[^\n]*?\})\s*,\s*\d+\s*\]/g;
  for(const match of text.matchAll(expression)){
   try{const data=JSON.parse(match[1]);if(/^[0-9]{5,25}$/.test(String(data.USER_ID||'')))ids.add(String(data.USER_ID));}catch{}
  }
 }
 return ids.size===1?[...ids][0]:null;
}
async function accountAssertSeller(tabId,expected){
 const tab=await chrome.tabs.get(tabId);
 if(!/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(tab.url||''))throw Error('Use a blank Facebook item form in the destination account.');
 const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:accountCurrentSeller});
 const actual=result[0]?.result;
 if(!actual)throw Error('Could not verify the signed-in seller. Nothing was posted.');
 if(actual!==expected)throw Error('Wrong Facebook account. Switch to the selected destination before retrying.');
 return actual;
}
async function accountWaitTab(tabId){
 for(let i=0;i<90;i++){
  const tab=await chrome.tabs.get(tabId);
  if(tab.status==='complete'&&/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item/.test(tab.url||''))return;
  await sleepCloud(500);
 }throw Error('Facebook did not open its listing form. Sign in to the destination account.');
}
async function accountPhotos(urls){
 if(!Array.isArray(urls)||urls.length<1||urls.length>10)throw Error('Choose one to ten photos');
 const blobs=[];let total=0;
 for(const [i,url] of urls.entries()){
  if(typeof url!=='string'||!url.startsWith(accountPhotoRoot))throw Error('Unverified photo host');
  const response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok)throw Error('An archived product photo is unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;
  if(bytes.length>16*1024*1024||total>35*1024*1024)throw Error('Selected photos exceed the upload limit');
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!jpg&&!png&&!webp)throw Error('A product photo is not a supported image');
  const mime=jpg?'image/jpeg':png?'image/png':'image/webp';
  let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
  blobs.push({dataUrl:'data:'+mime+';base64,'+btoa(binary),name:'product-'+(i+1)+(jpg?'.jpg':png?'.png':'.webp')});
 }return blobs;
}
async function accountStagePhotos(tabId,photos){
 const rows=[];
 try{for(const [i,photo] of photos.entries()){
  const id=await chrome.downloads.download({url:photo.dataUrl,filename:'CrazyMoe-sync/account-queue/'+tabId+'-'+Date.now()+'/'+photo.name,saveAs:false,conflictAction:'uniquify'});
  rows.push({id,path:await waitStudioDownload(id)});
 }return rows;}catch(error){await removeStagedPhotos(rows);throw error;}
}
async function accountFill(token){
 if(accountQueueBusy)throw Error('Another account transfer is still running');
 accountQueueBusy=true;let staged=[],tab;
 try{
  let packet=await accountTransfer(token,'read');
  tab=await chrome.tabs.create({url:'https://www.facebook.com/marketplace/create/item',active:true});
  await accountWaitTab(tab.id);
  await accountAssertSeller(tab.id,packet.profile_id);
  const photos=await accountPhotos(packet.item.images);
  // Recheck both stock and account after downloads, immediately before editing.
  packet=await accountTransfer(token,'read');
  await accountAssertSeller(tab.id,packet.profile_id);
  await chrome.scripting.executeScript({target:{tabId:tab.id},args:[packet.account_label],func:label=>{
   document.documentElement.setAttribute('data-crazymoe-cloud-review-only','1');
   const panel=document.getElementById('__moe_approved_panel__');if(panel)panel.style.display='none';
   const note=document.createElement('div');note.id='__moe_account_queue__';
   note.style.cssText='position:fixed;bottom:12px;right:12px;background:#152a3a;color:white;padding:14px;border:2px solid #f5ae37;border-radius:12px;z-index:2147483647;max-width:340px;font:14px system-ui';
   note.textContent='Destination: '+label+'. Loading your product…';document.documentElement.append(note);
  }});
  const prepared={...packet.item,images:[],imageBlobs:[],deferPhotos:true};
  const output=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:moeFillExplicitListing,args:[prepared,true]});
  if(!output[0]?.result?.ok)throw Error(output[0]?.result?.error||'Facebook field fill failed');
  await waitFacebookFields(tab.id,prepared);await waitFacebookCondition(tab.id,prepared.condition);
  await accountAssertSeller(tab.id,packet.profile_id);
  staged=await accountStagePhotos(tab.id,photos);
  await setNativeFacebookPhotos(tab.id,staged.map(x=>x.path));
  await waitFacebookPhotoCount(tab.id,photos.length);
  await waitFacebookFields(tab.id,prepared);await waitFacebookCondition(tab.id,prepared.condition);
  await accountAssertSeller(tab.id,packet.profile_id);
  await accountTransfer(token,'filled',{profile_id:packet.profile_id,photo_count:photos.length});
  await scheduleStagedPhotoCleanup(staged);staged=[];
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
   const note=document.getElementById('__moe_account_queue__');if(note)note.textContent+=' Fields and photos verified. Check category and location, publish on Facebook, then record the new listing link in Studio to continue.';
  }});
  return {ok:true,filled:true,tabId:tab.id};
 }catch(error){
  await accountTransfer(token,'error',{error:String(error.message).slice(0,500)}).catch(()=>{});
  return {ok:false,error:error.message,tabId:tab?.id};
 }finally{await removeStagedPhotos(staged).catch(()=>{});accountQueueBusy=false;}
}
chrome.runtime.onMessageExternal.addListener((message,sender,reply)=>{
 if(!studioOrigins.has(sender.origin))return false;
 if(message?.type==='STUDIO_ACCOUNT_QUEUE_CHECK'){reply({ready:true,version:1});return false;}
 if(message?.type==='STUDIO_ACCOUNT_QUEUE_IDENTIFY'){
  (async()=>{const tab=await chrome.tabs.create({url:'https://www.facebook.com/marketplace/create/item',active:true});await accountWaitTab(tab.id);
   const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:accountCurrentSeller});
   if(!result[0]?.result)throw Error('Could not read the signed-in Facebook identity. Sign in and try again.');
   return {profile_id:result[0].result};
  })().then(reply).catch(error=>reply({error:error.message}));return true;
 }
 if(message?.type!=='STUDIO_ACCOUNT_QUEUE_FILL'||! /^[a-f0-9]{64}$/.test(message.token||''))return false;
 accountFill(message.token).then(reply).catch(error=>reply({ok:false,error:error.message}));return true;
});
