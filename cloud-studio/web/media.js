"use strict";
const studioImages = (() => {
 const cache=new Map(),pending=new Map();
 async function url(key,force=false) {
  if(force)cache.delete(key);
  const hit=cache.get(key);if(hit&&Date.now()<hit.expires)return hit.url;
  if(pending.has(key))return pending.get(key);
  const task=request("/functions/v1/studio-api/"+key).then(result=>{
   if(!result.url)throw Error("Photo link unavailable");
   cache.set(key,{url:result.url,expires:Date.now()+Math.max(0,(Number(result.expires_in)||60)-15)*1000});return result.url;
  }).finally(()=>pending.delete(key));pending.set(key,task);return task;
 }
 async function load(img,key,active=()=>true) {
  for(let attempt=0;attempt<2;attempt++) {
   try {
    const src=await url(key,attempt>0);if(!active())return;
    img.src=src;await img.decode();if(!img.naturalWidth)throw Error("Photo did not decode");return;
   }catch(error){if(!active())return;if(attempt)throw Error("Photo unavailable. Refresh photos to retry.");}
  }
 }
 return {load,clear:()=>cache.clear()};
})();
