const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../../20261115/live-vercel/src/health.js'),'utf8');

async function health(served, recorded) {
  const elements = new Map();
  function node() {
    return {classList:{add(){}},style:{},append(){},replaceChildren(){}};
  }
  const document = {
    createElement:node,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id,node());
      return elements.get(id);
    }
  };
  const context = {document, AbortSignal, setTimeout, Date,
    studioAuth:{auth:{initialize:async()=>{},getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange(){}}},
    fetch:async url => ({
      ok:true,
      json:async()=>url === '/version.json' ? {git_sha:served} :
        {release:{active:true,git_sha:recorded},worker:{connected:true},inventory:{},telemetry:{}}
    })
  };
  vm.runInNewContext(source,context);
  await new Promise(setImmediate);
  return [elements.get('overall').textContent,elements.get('status').textContent];
}

test('health checks the exact deployment SHA and fails closed if its stamp is absent',async()=>{
  const expected = 'a'.repeat(40);
  assert.equal((await health(expected,expected))[0],'HEALTHY');
  const mismatch = await health('b'.repeat(40),expected);
  assert.equal(mismatch[0],'ATTENTION');
  assert.match(mismatch[1],/Release drift/);
  const missing = await health(null,expected);
  assert.equal(missing[0],'ATTENTION');
  assert.match(missing[1],/could not be verified/);
});
