const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(__dirname+"/sync_observed.js","utf8");
(async () => {
  let calls = 0, fail = true;
  const context = {chrome:{runtime:{sendMessage:async request=>{
    assert.equal(request.type,"STUDIO_SYNC_OBSERVATIONS");
    assert.equal(request.account,"crazymoe");
    assert.equal(request.rows.length,calls++ % 2 ? 1 : 50);
    return fail && calls === 2 ? {ok:false,error:"Disconnected"} : {ok:true,matched:request.rows.length,pending:0};
  }}}};
  vm.runInNewContext(source,context);
  const input = Array.from({length:51},(_,i)=>({facebook_id:String(1000000000+i)}));
  const progress = [];
  const run = () => context.syncObservedListings(input,"crazymoe","full",count=>progress.push(count));
  await assert.rejects(run(),/Previously confirmed observations: 50/);
  assert.deepEqual(progress,[50]);
  fail=false;
  assert.equal((await run()).matched,51);
  assert.deepEqual(progress,[50,50,51]);
  console.log("Failed second batch, confirmed counts and retry passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
