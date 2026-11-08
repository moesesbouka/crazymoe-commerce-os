/* Approved inventory, seller confirmation, and the next blank Facebook form. */
'use strict';
const studioPickerOpening=new Set();
function studioPickerSender(sender,allowPopup=false){
 if(sender.id!==chrome.runtime.id)return false;
 if(allowPopup&&sender.url?.startsWith(chrome.runtime.getURL('')))return true;
 return sender.frameId===0&&Boolean(sender.tab?.id)&&/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(sender.url||'');
}
async function studioPickerRpc(name,args={}){
 const response=await studioMemberFetch('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 const value=await response.json();if(!response.ok)throw Error(value.message||value.error||'Studio could not load the approved queue');return value;
}
function studioApprovedRows(state){
 if(!Array.isArray(state))throw Error('Studio returned an invalid inventory response');
 const value=(item,key)=>Object.hasOwn(item.fields||{},key)?item.fields[key]:item.generated_candidate?.[key];
 return state.filter(item=>item.status==='approved'&&item.lifecycle!=='archived').map(item=>({
  id:item.id,revision:Number(item.revision),title:String(value(item,'title')||item.id),
  price:value(item,'price')??null,condition:String(value(item,'condition')||''),photo_count:Array.isArray(item.photo_selection)?item.photo_selection.length:0
 })).sort((a,b)=>a.title.localeCompare(b.title));
}
// Run inside the listing tab. Search and pickup-location defaults are intentionally ignored.
function studioPickerBlank(){
 if(document.documentElement.hasAttribute('data-crazymoe-import-owner'))return false;
 const visible=e=>e.getClientRects().length>0;
 const controls=[...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible),seen=new Set();
 for(const field of controls){
  const label=[field.getAttribute('aria-label'),field.closest('label')?.innerText].filter(Boolean).join(' ');
  const name=label.match(/\b(title|price|description)\b/i)?.[1]?.toLowerCase();
  if(name){seen.add(name);if(String(field.value??field.innerText??'').trim())return false;}
 }
 if([...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length))return false;
 if(document.querySelector('img[alt^="Listing photo"]'))return false;
 const photos=String(document.body.innerText||'').match(/Photos\s*·\s*(\d+)\s*\/\s*10/i);
 return seen.has('title')&&seen.has('description')&&seen.has('price')&&(!photos||Number(photos[1])===0);
}
async function studioAssertBlank(tabId){
 const tab=await chrome.tabs.get(tabId);
 if(!/^https:\/\/(www|m)\.facebook\.com\/marketplace\/create\/item\/?(?:[?#]|$)/.test(tab.url||''))throw Error('Open a blank Facebook item form first.');
 const result=await chrome.scripting.executeScript({target:{tabId},func:studioPickerBlank});
 if(result[0]?.result!==true)throw Error('This form already contains a draft or is not ready. Use a fully loaded blank Facebook item form; your current draft is preserved.');
}
async function studioPickerSelect(tabId,id,revision){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!Number.isSafeInteger(revision)||revision<0)throw Error('Refresh the approved list and choose a product.');
 if(studioPickerOpening.has(tabId)||studioFillBusy.has(tabId))throw Error('A product is already loading in this tab.');
 studioPickerOpening.add(tabId);
 try{
  const key='studioDraft'+tabId;
  if((await chrome.storage.session.get(key))[key])throw Error('This tab already has a Studio draft assigned. Load that draft or open a new blank item form.');
  await studioAssertBlank(tabId);
  // Rechecks membership, current revision, exact approved snapshot and photo eligibility on the server.
  const token=await studioPickerRpc('studio_issue_handoff',{p_item:id,p_revision:revision});
  if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))throw Error('Studio did not issue a valid approved transfer.');
  await studioAssertBlank(tabId);
  await chrome.storage.session.set({[key]:token});
  return await studioFillApprovedTab(tabId);
 }finally{studioPickerOpening.delete(tabId);}
}
const STUDIO_CONTEXT='studioApprovedContext';
let studioAdvancing=false;
const studioContext=async tabId=>(await chrome.storage.session.get(STUDIO_CONTEXT+tabId))[STUDIO_CONTEXT+tabId]||null;
const studioSaveContext=(tabId,value)=>chrome.storage.session.set({[STUDIO_CONTEXT+tabId]:{...value,updated_at:Date.now()}});
function studioMarketSender(sender){
 return sender.id===chrome.runtime.id&&sender.frameId===0&&Boolean(sender.tab?.id)&&/^https:\/\/(www|m)\.facebook\.com\/marketplace(?:\/|[?#]|$)/.test(sender.url||'');
}
async function studioWaitBlank(tabId){
 for(let i=0;i<120;i++){
  const tab=await chrome.tabs.get(tabId);
  if(tab.status==='complete'){
   try{await studioAssertBlank(tabId);return;}catch{}
  }
  await sleepCloud(250);
 }
 throw Error('The new Facebook form did not become ready. Finish loading it, then retry on a new form.');
}
async function studioAutoFill(tabId,item){
 try{
  await studioWaitBlank(tabId);
  const result=await studioPickerSelect(tabId,item.id,item.revision);
  if(!result?.ok)throw Error(result?.error||'Facebook could not load this product');
 }catch(error){
  await studioSaveContext(tabId,{...item,phase:'error',error:String(error.message||error)});
 }
}
async function studioNewForm(sourceTabId,item){
 const tab=await chrome.tabs.create({url:'about:blank',active:true});
 // Persist the link before navigation: repeated confirmation focuses this same tab.
 const source=await studioContext(sourceTabId);
 await studioSaveContext(sourceTabId,{...source,nextTabId:tab.id});
 await studioSaveContext(tab.id,{...item,phase:'loading'});
 try{
  await chrome.tabs.update(tab.id,{url:'https://www.facebook.com/marketplace/create/item/'});
 }catch(error){
  await studioSaveContext(tab.id,{...item,phase:'error',error:String(error.message||error)});
  throw error;
 }
 void studioAutoFill(tab.id,item);
 return {ok:true,confirmed:source?.phase==='confirmed',nextTabId:tab.id,title:item.title};
}
async function studioOpenNext(tabId){
 const context=await studioContext(tabId);
 if(context?.nextTabId){
  try{await chrome.tabs.get(context.nextTabId);await chrome.tabs.update(context.nextTabId,{active:true});return {ok:true,confirmed:true,nextTabId:context.nextTabId};}catch{}
 }
 const rows=studioApprovedRows(await studioPickerRpc('studio_state'));
 const sessions=await chrome.storage.session.get(null);
 const occupied=new Set(Object.entries(sessions).filter(([key,value])=>key.startsWith(STUDIO_CONTEXT)&&['loaded','loading','error'].includes(value?.phase)).map(([,value])=>value.id));
 const next=rows.find(item=>!occupied.has(item.id));
 if(!next){
  const waiting=rows.length>0;
  await studioSaveContext(tabId,{...context,phase:'confirmed',done:!waiting,waiting});
  return {ok:true,confirmed:true,done:!waiting,waiting};
 }
 return studioNewForm(tabId,next);
}
async function studioAdvance(tabId,message){
 if(studioAdvancing)throw Error('The next product is already being opened.');
 studioAdvancing=true;
 try{
  let context=await studioContext(tabId);
  if(message.type==='STUDIO_APPROVED_RETRY'){
   if(context?.phase!=='error')throw Error('Only an incomplete load can be retried.');
   if(context.nextTabId){try{await chrome.tabs.get(context.nextTabId);await chrome.tabs.update(context.nextTabId,{active:true});return {ok:true,nextTabId:context.nextTabId};}catch{}}
   return await studioNewForm(tabId,{id:context.id,revision:context.revision,title:context.title});
  }
  if(context?.phase!=='confirmed'){
   if(message.type==='STUDIO_APPROVED_NEXT')throw Error('Confirm the current product as posted first.');
   if(message.type==='STUDIO_APPROVED_ALREADY'){
    if(context&&['loaded','loading','error'].includes(context.phase))throw Error('Finish the product already assigned to this tab first.');
    const rows=studioApprovedRows(await studioPickerRpc('studio_state'));
    context=rows.find(item=>item.id===message.id&&item.revision===message.revision);
    if(!context)throw Error('This approval changed. Refresh the approved list.');
   }else if(context?.phase!=='loaded')throw Error('Load an approved product before confirming it as posted.');
   const result=await studioPickerRpc('studio_confirm_published',{p_item:context.id,p_revision:context.revision,p_confirmed:true});
   if(!result?.ok)throw Error('Studio did not save the posted confirmation.');
   context={...context,phase:'confirmed',confirmed_at:Date.now()};
   await studioSaveContext(tabId,context);
  }
  try{return await studioOpenNext(tabId);}catch(error){return {ok:false,confirmed:true,error:'Marked as listed. '+String(error.message||error)+' Use Open next approved product to continue.'};}
 }finally{studioAdvancing=false;}
}
chrome.tabs.onRemoved.addListener(tabId=>{void chrome.storage.session.remove(STUDIO_CONTEXT+tabId);});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 const type=message?.type;
 if(!['STUDIO_APPROVED_LIST','STUDIO_APPROVED_SELECT','STUDIO_APPROVED_CONTEXT','STUDIO_APPROVED_CONFIRM','STUDIO_APPROVED_ALREADY','STUDIO_APPROVED_NEXT','STUDIO_APPROVED_RETRY'].includes(type))return false;
 (async()=>{
  const ordinary=studioPickerSender(sender,type==='STUDIO_APPROVED_LIST');
  const market=studioMarketSender(sender);
  if(!ordinary&&!market)throw Error('Open the approved panel on Facebook or the Commerce OS popup.');
  const context=sender.tab?.id?await studioContext(sender.tab.id):null;
  if(type==='STUDIO_APPROVED_CONTEXT')return {ok:true,context};
  if(!ordinary&&!context)throw Error('No approved product is assigned to this Facebook tab.');
  if(type==='STUDIO_APPROVED_LIST')return {ok:true,items:studioApprovedRows(await studioPickerRpc('studio_state'))};
  if(type==='STUDIO_APPROVED_SELECT'){
   if(!studioPickerSender(sender))throw Error('Open a blank Facebook item form first.');
   return studioPickerSelect(sender.tab.id,message.id,message.revision);
  }
  return studioAdvance(sender.tab.id,message);
 })().then(reply).catch(error=>reply({ok:false,error:String(error.message||error)}));return true;
});
