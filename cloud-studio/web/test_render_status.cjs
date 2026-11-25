const {test}=require('node:test');
const assert=require('node:assert/strict');
require('./render-status.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('queued and running disable review; ready enables it',async()=>{
 const states=['queued','running','ready'],seen=[],timers=[];
 studioRenderStatus.watch({read:async()=>({state:states.shift(),revision:2}),revision:2,active:()=>true,show:(m,ready)=>seen.push(ready),schedule:f=>timers.push(f),cancel:()=>{}});
 await flush();await timers.shift()();await timers.shift()();assert.deepEqual(seen,[false,false,true]);assert.equal(timers.length,0);
});
test('late response after navigation cannot change current editor',async()=>{
 let resolve;const seen=[];
 const stop=studioRenderStatus.watch({read:()=>new Promise(r=>resolve=r),revision:1,active:()=>true,show:x=>seen.push(x),cancel:()=>{}});
 stop();resolve({state:'ready',revision:1});await flush();assert.equal(seen.length,0);
});
test('stale revision cannot enable review',async()=>{
 const seen=[];studioRenderStatus.watch({read:async()=>({state:'ready',revision:2}),revision:1,active:()=>true,show:(m,r)=>seen.push(r)});
 await flush();assert.deepEqual(seen,[false]);
});
test('connection loss remains disabled and schedules a retry',async()=>{
 let delay;const seen=[];studioRenderStatus.watch({read:async()=>{throw Error('offline');},revision:1,active:()=>true,show:(m,r)=>seen.push(r),schedule:(f,d)=>delay=d});
 await flush();assert.deepEqual(seen,[false]);assert.equal(delay,15000);
});
