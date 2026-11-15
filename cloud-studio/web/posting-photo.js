/* Shared by Studio and the extension worker. Originals are never written. */
(function(root){
 'use strict';
 const VERSION='alt-frame-v1',PHOTO_ROOT='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/';
 const MAX_BYTES=16*1024*1024,MAX_PIXELS=40000000;
 function seed(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
 function recipe(profile,source,url){
  if(!/^[0-9]{5,25}$/.test(String(profile))||! /^-?[0-9]+$/.test(String(source))||!url.startsWith(PHOTO_ROOT))throw Error('Photo identity is incomplete');
  const variant=seed(profile+'|'+source+'|'+url);
  return {version:VERSION,border:18+variant%17,band:34,radius:22,label:'ITEM '+source,comment:'CrazyMoe|'+VERSION+'|source='+source+'|variant='+variant.toString(16)};
 }
 function geometry(width,height,r){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>MAX_PIXELS)throw Error('Photo dimensions are unsupported');
  const scale=Math.min(1,(1600-2*r.border)/width,(1600-2*r.border-r.band)/height);
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  // Padding outside the complete photograph: no rounded-corner clipping of product pixels.
  return {width:w+2*r.border,height:h+2*r.border+r.band,x:r.border,y:r.border,imageWidth:w,imageHeight:h};
 }
 function mime(bytes){
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';
  if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  throw Error('Photo is not a supported JPEG, PNG, or WebP image');
 }
 async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 async function read(url){
  if(typeof url!=='string'||!url.startsWith(PHOTO_ROOT))throw Error('Unverified photo host');
  const response=await fetch(url,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('A product photo is unavailable ('+response.status+')');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Photo is too large');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw Error('Photo is too large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}mime(bytes);return bytes;
 }
 // Minimal valid EXIF: IFD0 -> ExifIFD -> ASCII UserComment. No dates/GPS/seller identity are fabricated.
 function withComment(jpeg,comment){
  if(jpeg[0]!==255||jpeg[1]!==216)throw Error('JPEG export failed');
  const text=new TextEncoder().encode('ASCII\0\0\0'+comment),tiff=new Uint8Array(44+text.length),v=new DataView(tiff.buffer);
  tiff.set([73,73,42,0]);v.setUint32(4,8,true);v.setUint16(8,1,true);
  v.setUint16(10,0x8769,true);v.setUint16(12,4,true);v.setUint32(14,1,true);v.setUint32(18,26,true);v.setUint32(22,0,true);
  v.setUint16(26,1,true);v.setUint16(28,0x9286,true);v.setUint16(30,7,true);v.setUint32(32,text.length,true);v.setUint32(36,44,true);v.setUint32(40,0,true);tiff.set(text,44);
  const payload=new Uint8Array(6+tiff.length);payload.set([69,120,105,102,0,0]);payload.set(tiff,6);
  const result=new Uint8Array(jpeg.length+payload.length+4);result.set(jpeg.slice(0,2));result.set([255,225,(payload.length+2)>>8,(payload.length+2)&255],2);result.set(payload,6);result.set(jpeg.slice(2),6+payload.length);return result;
 }
 async function prepare(url,{profile,source,expectedSha}={}){
  const r=recipe(profile,source,url),bytes=await read(url),sourceSha=await sha256(bytes);
  if(expectedSha&&expectedSha!==sourceSha)throw Error('Source photo changed. Prepare this product again before uploading.');
  const bitmap=await createImageBitmap(new Blob([bytes],{type:mime(bytes)}),{imageOrientation:'from-image'});
  let g,canvas;
  try{
   g=geometry(bitmap.width,bitmap.height,r);canvas=new OffscreenCanvas(g.width,g.height);const ctx=canvas.getContext('2d',{alpha:false});
   if(!ctx)throw Error('Photo rendering is unavailable in this browser');
   ctx.fillStyle='#efeeeb';ctx.fillRect(0,0,g.width,g.height);
   ctx.fillStyle='#191919';ctx.beginPath();ctx.roundRect(0,0,g.width,g.height-r.band,Math.min(r.radius,r.border));ctx.fill();
   ctx.fillStyle='#fff';ctx.fillRect(g.x,g.y,g.imageWidth,g.imageHeight);
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,g.x,g.y,g.imageWidth,g.imageHeight);
   // Reference is placed in the new footer, never over the item, labels, or defects.
   ctx.fillStyle='#626660';ctx.textAlign='right';ctx.textBaseline='middle';ctx.font='12px sans-serif';ctx.fillText(r.label,g.width-r.border,g.height-r.band/2,Math.max(1,g.width-2*r.border));
   const encoded=await canvas.convertToBlob({type:'image/jpeg',quality:.94});
   if(encoded.type!=='image/jpeg')throw Error('JPEG export is unavailable');
   const output=withComment(new Uint8Array(await encoded.arrayBuffer()),r.comment);
   return {blob:new Blob([output],{type:'image/jpeg'}),sourceBytes:bytes.length,manifest:{url,source_sha256:sourceSha,width:g.width,height:g.height},output_sha256:await sha256(output)};
  }finally{bitmap.close();if(canvas){canvas.width=1;canvas.height=1;}}
 }
 async function dataUrl(blob){const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:'+blob.type+';base64,'+btoa(s);}
 const api={VERSION,recipe,geometry,mime,sha256,read,prepare,withComment,dataUrl};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PostingPhoto=api;
})(globalThis);
