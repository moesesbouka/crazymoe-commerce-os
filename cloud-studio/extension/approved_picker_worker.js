/* Live cloud-approved inventory for a blank Facebook item form. */
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
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!['STUDIO_APPROVED_LIST','STUDIO_APPROVED_SELECT'].includes(message?.type))return false;
 if(!studioPickerSender(sender,message.type==='STUDIO_APPROVED_LIST')){reply({ok:false,error:'Open the approved panel on Facebook or the Commerce OS popup.'});return false;}
 const task=message.type==='STUDIO_APPROVED_LIST'
  ?studioPickerRpc('studio_state').then(state=>({ok:true,items:studioApprovedRows(state)}))
  :studioPickerSelect(sender.tab.id,message.id,message.revision);
 task.then(reply).catch(error=>reply({ok:false,error:String(error.message||error)}));return true;
});
