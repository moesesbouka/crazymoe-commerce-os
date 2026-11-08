"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

let external,internal,removed;
const sessionStore={};
const requests=[];
const chrome={
  runtime:{
    id:"extension-id",getURL:path=>"chrome-extension://extension-id/"+path,
    onMessageExternal:{addListener(fn){external=fn;}},
    onMessage:{addListener(fn){internal=fn;}}
  },
  tabs:{
    onRemoved:{addListener(fn){removed=fn;}},
    async create(){return {id:9};},async update(){}
  },
  storage:{session:{
    async get(key){return {[key]:sessionStore[key]};},
    async set(value){Object.assign(sessionStore,value);},
    async remove(key){delete sessionStore[key];}
  }}
};
const context=vm.createContext({chrome,URL,Uint8Array,TextEncoder,console,
  fetch:async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).includes("grant_type=refresh_token"))return {ok:true,json:async()=>({
      access_token:"new.token.value",refresh_token:"r".repeat(12),expires_at:Math.floor(Date.now()/1000)+3600
    })};
    return {ok:true,json:async()=>({})};
  }
});
vm.runInContext(fs.readFileSync(__dirname+"/cloud_handoff.js","utf8"),context);
assert.equal(typeof external,"function");
assert.equal(typeof internal,"function");
assert.equal(typeof removed,"function");

function connect(message,origin="https://crazymoe-marketplace-studio.vercel.app"){
  return new Promise(resolve=>assert.equal(external(message,{origin},resolve),true));
}
(async()=>{
  const fresh={access_token:"old.token.value",refresh_token:"x".repeat(12),expires_at:Math.floor(Date.now()/1000)+3600};
  assert.equal((await connect({type:"STUDIO_AUTH_SESSION",session:fresh})).ok,true);
  assert.equal((await connect({type:"STUDIO_AUTH_SESSION",session:{...fresh,refresh_token:"short"}})).ok,false);
  await vm.runInContext("studioMemberFetch('/rest/v1/active_listings?limit=1')",context);
  assert.equal(requests.at(-1).options.headers.Authorization,"Bearer old.token.value");
  assert.equal(external({type:"STUDIO_AUTH_SESSION",session:fresh},{origin:"https://evil.invalid"},()=>{}),false);
  const probe=await new Promise(resolve=>assert.equal(internal({type:"STUDIO_MEMBER_PROBE"},
    {id:"extension-id",url:"chrome-extension://extension-id/member_probe.html"},resolve),true));
  assert.equal(probe.ok,true);

  sessionStore.studioAuthSession.expires_at=Math.floor(Date.now()/1000)-1;
  await vm.runInContext("studioMemberFetch('/rest/v1/action_queue?limit=1')",context);
  assert.match(requests.at(-2).url,/grant_type=refresh_token/);
  assert.equal(requests.at(-1).options.headers.Authorization,"Bearer new.token.value");
  assert.equal(sessionStore.studioAuthSession.access_token,"new.token.value");
  console.log("PASS: allowed Studio origin stores only a session-scoped token; expired tokens refresh and member API calls replace legacy credentials");
})().catch(error=>{console.error(error);process.exitCode=1;});
