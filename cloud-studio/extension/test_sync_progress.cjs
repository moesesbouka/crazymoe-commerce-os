const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(__dirname + "/sync_progress.js", "utf8");

function scanner(sendMessage) {
  let heartbeat, closed = false;
  const sandbox = {
    chrome: {runtime: {sendMessage}},
    crypto: {randomUUID: () => "run"},
    setInterval: fn => { heartbeat = fn; return 1; },
    clearInterval: () => { closed = true; }
  };
  vm.runInNewContext(source, sandbox);
  return {start: sandbox.startFacebookImport, tick: async () => { heartbeat(); await new Promise(setImmediate); }, isClosed: () => closed};
}

test("replays an unacknowledged batch with the same ID and counts each listing once", async () => {
  const calls = [];
  const scan = scanner(async message => {
    calls.push(message);
    if (message.action === "saving") assert.equal(message.found, 1);
    if (message.action === "batch" && calls.filter(call => call.action === "batch").length === 1) throw Error("response lost");
    return {ok: true, state: message.action === "complete" ? "completed" : "saving", processed: 1, refreshed: 1, pending: 0, skipped: 0};
  });
  const run = await scan.start("crazymoe", "full");
  const item = {facebook_id: "1000000001"};
  const counts = await run.save([item, item], (processed, found) => {
    assert.equal(processed, 1);
    assert.equal(found, 1);
  });
  const batches = calls.filter(call => call.action === "batch");
  assert.equal(batches.length, 2);
  assert.equal(batches[0], batches[1]);
  assert.equal(counts.matched, 1);
  assert(scan.isClosed());
});

test("stopping in Studio stops discovery and ends the heartbeat", async () => {
  const actions = [];
  const scan = scanner(async message => {
    actions.push(message.action);
    return {ok: true, state: message.action === "start" ? "discovering" : "stopped"};
  });
  const run = await scan.start("crazymoe", "full");
  run.discoveryProgress(42);
  await scan.tick();
  assert.throws(() => run.discoveryProgress(43), /stopped in Studio/);
  await run.fail();
  assert.deepEqual(actions, ["start", "heartbeat", "fail"]);
  assert(scan.isClosed());
});
