const {test}=require('node:test');
const assert=require('node:assert/strict');
const photo=require('./posting-photo.js');
const url='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/test/photo.jpg';
test('stable recipe preserves complete portrait, landscape, and small images',()=>{
 const r=photo.recipe('123456789',42,url);assert.deepEqual(r,photo.recipe('123456789',42,url));
 for(const [w,h] of [[4000,3000],[2400,4000],[640,480],[1,1]]){const g=photo.geometry(w,h,r);assert.ok(g.width<=1600&&g.height<=1600);assert.equal(g.x,r.border);assert.equal(g.width,g.imageWidth+2*r.border);assert.equal(g.height,g.imageHeight+2*r.border+r.band);assert.ok(g.imageWidth<=w&&g.imageHeight<=h);}
 assert.throws(()=>photo.geometry(10000,10000,r),/dimensions/);
});
test('invalid identity and external photos are rejected',()=>{
 assert.throws(()=>photo.recipe('vanity',1,url),/identity/);assert.throws(()=>photo.recipe('123456789',1,'https://untrusted.test/x'),/identity/);
 assert.throws(()=>photo.mime(new Uint8Array([60,104,116,109,108])),/supported/);
});
test('EXIF has a valid TIFF pointer and honest source comment',()=>{
 const input=new Uint8Array([255,216,255,217]),comment='CrazyMoe|alt-frame-v1|source=42',out=photo.withComment(input,comment),v=new DataView(out.buffer);
 assert.equal(out[2],255);assert.equal(out[3],225);assert.equal(v.getUint16(4,false),out.length-input.length-2);
 const tiff=12;assert.equal(v.getUint32(tiff+18,true),26);assert.equal(v.getUint16(tiff+28,true),0x9286);
 assert.equal(new TextDecoder().decode(out.slice(tiff+44,-2)),'ASCII\0\0\0'+comment);
 assert.deepEqual([...input],[255,216,255,217]);
});
