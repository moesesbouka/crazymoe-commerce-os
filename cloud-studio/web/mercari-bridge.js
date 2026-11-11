'use strict';
globalThis.MercariBridge=(()=>{
 const pending=new Map(),handlers=new Set();
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin)return;
  if(event.data?.channel==='CRAZYMOE_MERCARI_RESPONSE'){
   const hit=pending.get(event.data.requestId);if(!hit)return;pending.delete(event.data.requestId);clearTimeout(hit.timer);
   event.data.result?.ok?hit.resolve(event.data.result):hit.reject(Error(event.data.result?.error||'Mercari companion did not respond.'));
  }
  if(event.data?.channel==='CRAZYMOE_MERCARI_EVENT')for(const fn of handlers)fn(event.data.result);
 });
 function request(type,payload={},timeout=8000){return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Reload Crazy Moe Mercari Companion 2.0 in Chrome, then refresh this page.'));},timeout);
  pending.set(requestId,{resolve,reject,timer});window.postMessage({channel:'CRAZYMOE_MERCARI_REQUEST',requestId,type,payload},location.origin);
 });}
 return {request,onResult:fn=>handlers.add(fn)};
})();
