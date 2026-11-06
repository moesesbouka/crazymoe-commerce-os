import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runRender} from './process.mjs';
const hash=async b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const job={snapshot:{recipe:'fixture',selection:[{sha:'one',kind:'real',style_mode:'blur',pop:true},{sha:'two',kind:'real'}]}};
 const context={photos:[{sha256:'one',bytes:10,bucket:'studio-originals',object_path:'one'},{sha256:'two',bytes:20,bucket:'studio-originals',object_path:'two'}]};
 const stored=new Map(),requests=[];
 const io={hash,sign:async p=>'https://signed/'+p.object_path,render:async body=>{requests.push(body);return new Uint8Array([255,216,body.bytes,255,217]);},
 upload:async(p,b)=>{if(!stored.has(p))stored.set(p,b);},download:async p=>stored.get(p)};
 return {job,context,io,stored,requests};
}
test('preserves selection order, options and upload/download receipts across retries',async()=>{
 const f=fixture(),a=await runRender(f.job,f.context,f.io),b=await runRender(f.job,f.context,f.io);
 assert.deepEqual(a,b);assert.equal(f.stored.size,2);assert.deepEqual(a.map(x=>x.source_sha),['one','two']);
 assert.equal(f.requests[0].style,'blur');assert.equal(f.requests[0].pop,true);assert.equal(f.requests[1].style,'natural');
});
test('rejects reordered or incomplete sources before registration',async()=>{
 for(const change of [f=>f.context.photos.reverse(),f=>f.context.photos.pop()]){
  const f=fixture();change(f);await assert.rejects(runRender(f.job,f.context,f.io));assert.equal(f.stored.size,0);
 }
});
test('rejects truncated and changed stored JPEG bytes',async()=>{
 for(const download of [async()=>new Uint8Array([255]),async()=>new Uint8Array([255,216,99,255,217])]){
  const f=fixture();f.io.download=download;await assert.rejects(runRender(f.job,f.context,f.io),/verification/);
 }
});
test('rejects non-JPEG renderer responses and oversized output',async()=>{
 for(const bytes of [new Uint8Array([1,2,3,4]),new Uint8Array(4000001)]){
  const f=fixture();f.io.render=async()=>bytes;await assert.rejects(runRender(f.job,f.context,f.io),/JPEG/);assert.equal(f.stored.size,0);
 }
});
