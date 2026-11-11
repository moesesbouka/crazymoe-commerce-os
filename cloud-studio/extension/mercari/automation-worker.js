'use strict';
const CM_STUDIO_ORIGINS=new Set(['https://studio.crazymoe.com','https://crazymoe-marketplace-studio.vercel.app']);
function cmStudio(sender){try{return sender.tab?.id&&CM_STUDIO_ORIGINS.has(new URL(sender.url).origin);}catch{return false;}}
function cmMercari(sender){try{const u=new URL(sender.url);return sender.tab?.id&&u.origin==='https://www.mercari.com'&&u.pathname==='/sell/';}catch{return false;}}
const cmKey=id=>'mercari-job:'+id;
// Image bytes do not belong in chrome.storage.session's small shared quota.
// IndexedDB holds only expiring, tab-bound transfer files, never account tokens.
const cmTestFiles=new Map();
async function cmFiles(action,id,files){
 if(typeof indexedDB==='undefined'){
  if(action==='put')cmTestFiles.set(id,files);
  if(action==='delete')cmTestFiles.delete(id);
  return cmTestFiles.get(id);
 }
 const db=await new Promise((resolve,reject)=>{const open=indexedDB.open('CrazyMoeMercariTransfers',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('files','readwrite'),table=tx.objectStore('files');let result;
  if(action==='put'){
   table.put({files,expires:Date.now()+60*60*1000},id);
   const cursor=table.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.value.expires<Date.now())c.delete();c.continue();}};
  }else if(action==='delete')table.delete(id);
  else{const request=table.get(id);request.onsuccess=()=>{const data=request.result;if(data?.expires>Date.now())result=data.files;else if(data)table.delete(id);};}
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Photo transfer interrupted'));
 });}finally{db.close();}
}
async function cmResult(tabId,result){
 const key=cmKey(tabId),job=(await chrome.storage.session.get(key))[key];if(!job)return;
 if(Date.now()>job.expires){await chrome.storage.session.remove(key);await cmFiles('delete',tabId);return;}
 const event={...result,requestId:job.requestId,queue_id:job.queue_id,revision:job.revision};
 job.phase=result.state;await chrome.storage.session.set({[key]:job});
 if(['filled','needs_attention','error','published'].includes(result.state))await cmFiles('delete',tabId);
 await chrome.tabs.sendMessage(job.studioTab,{type:'CM_MERCARI_RESULT',result:event}).catch(()=>{});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(!String(message.type||'').startsWith('CM_MERCARI_'))return;
 (async()=>{
  if(message.type==='CM_MERCARI_PING'){if(!cmStudio(sender))throw Error('Open the Mercari desk in Studio.');return {ok:true,version:2};}
  if(message.type==='CM_MERCARI_FILL'||message.type==='CM_MERCARI_CATEGORIES'){
   if(!cmStudio(sender))throw Error('Studio origin required.');
   const p=message.payload||{},mode=message.type.endsWith('CATEGORIES')?'categories':'fill';
   if(mode==='fill'){
    if(typeof p.queue_id!=='string'||!Number.isInteger(p.revision)||typeof p.draft?.title!=='string'||p.draft.title.length>80||p.draft.description.length>1000||!Array.isArray(p.draft.files)||p.draft.files.length<1||p.draft.files.length>12)throw Error('Complete this listing and select 1–12 photos first.');
    if(p.draft.files.reduce((n,f)=>n+String(f.base64||'').length,0)>42*1024*1024)throw Error('Photo transfer is too large. Use fewer or smaller photos.');
   }
   const tab=await chrome.tabs.create({url:'https://www.mercari.com/sell/',active:true});
   const safe={...p,draft:p.draft?{...p.draft}:undefined};
   if(safe.draft){await cmFiles('put',tab.id,safe.draft.files);delete safe.draft.files;}
   await chrome.storage.session.set({[cmKey(tab.id)]:{...safe,mode,studioTab:sender.tab.id,requestId:p.requestId,phase:'opening',expires:Date.now()+60*60*1000}});
   return {ok:true,tabId:tab.id,requestId:p.requestId};
  }
  if(message.type==='CM_MERCARI_READY'){
   if(!cmMercari(sender))throw Error('Mercari listing form required.');
   const job=(await chrome.storage.session.get(cmKey(sender.tab.id)))[cmKey(sender.tab.id)];
   if(!job||Date.now()>job.expires||!['opening','loading'].includes(job.phase))return {ok:true,job:null};
   job.phase='loading';await chrome.storage.session.set({[cmKey(sender.tab.id)]:job});
   const transfer={...job,draft:job.draft?{...job.draft,files:await cmFiles('get',sender.tab.id)}:undefined};
   if(job.mode==='fill'&&!transfer.draft.files)throw Error('Photo transfer expired. Open this item from Studio again.');
   return {ok:true,job:transfer};
  }
  if(message.type==='CM_MERCARI_SUBMIT'){
   if(!cmMercari(sender))throw Error('Mercari form required.');const key=cmKey(sender.tab.id),job=(await chrome.storage.session.get(key))[key];if(job&&['filled','needs_attention'].includes(job.phase)){job.submitAt=Date.now();await chrome.storage.session.set({[key]:job});}return {ok:true};
  }
  if(message.type==='CM_MERCARI_PROGRESS'){
   if(!cmMercari(sender))throw Error('Mercari form required.');await cmResult(sender.tab.id,message.result);return {ok:true};
  }
  throw Error('Unknown Mercari operation');
 })().then(respond).catch(e=>respond({ok:false,error:e.message}));return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{
 if(!change.url)return;
 try{const u=new URL(change.url);if(u.origin==='https://www.mercari.com'&&/^\/us\/item\/m\d+\/?$/.test(u.pathname))chrome.storage.session.get(cmKey(id)).then(data=>{const job=data[cmKey(id)];if(job?.submitAt&&Date.now()-job.submitAt<120000&&job.phase!=='published')return cmResult(id,{state:'published',url:u.origin+u.pathname});}).catch(()=>{});}catch{}
});
chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove(cmKey(id)).catch(()=>{});cmFiles('delete',id).catch(()=>{});});
