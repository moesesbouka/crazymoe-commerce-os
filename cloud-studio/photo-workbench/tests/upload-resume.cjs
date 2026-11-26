const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../../..");
const portal = path.join(root, "stabilization/20261115/live-vercel/src/photo-workbench-app.js");
const sources = process.argv.slice(2).length ? process.argv.slice(2) : [portal];

async function verify(source) {
  const files = ["one", "two", "three"].map((sha, index) => ({
    id: sha, sha, name: sha + ".jpg", size: 32, offset: index < 2 ? 32 : 8,
    state: index < 2 ? "accepted" : "pending",
  }));
  const batch = { id: "test-batch", state: "receiving", files };
  const requests = [];
  const picker = { clicks: 0, click() { this.clicks++; } };
  const receipt = { replaceChildren(node) { this.value = node; } };
  const response = { ok: true, headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => batch };
  const dispatch = async (route, options) => {
    requests.push([route, options.method]);
    return response;
  };
  const ui = vm.createContext({
    Intl, AbortSignal, fetch: dispatch, workbenchRequest: dispatch,
    document: {
      getElementById(id) { return id === "photos" ? picker : receipt; },
      createElement(tag) {
        return {
          tag, children: [], append(...items) { this.children.push(...items); },
          setAttribute() {}, addEventListener(event, callback) { this[event] = callback; },
        };
      },
    },
    batch, selected: files.map(file => ({ file: { name: file.name }, receipt: { sha: file.sha, size: file.size } })),
  });
  const script = fs.readFileSync(source, "utf8").replace(/^import .*;\n/, "");
  vm.runInContext(script.slice(0, script.lastIndexOf('\ndocument.querySelectorAll("[data-view]")')), ui);
  vm.runInContext("drawReceipt(batch)", ui);
  assert.match(receipt.value.children[2].textContent, /photo picker will open.*original 3.*all 1 remaining/i);
  const button = receipt.value.children.find(node => node.textContent === "Choose photos to resume");
  assert.ok(button);
  button.click();
  assert.equal(picker.clicks, 1);
  assert.equal(vm.runInContext("resumeBatchId", ui), batch.id);

  const pending = await vm.runInContext("openUpload([selected[2]], batch.id, true)", ui);
  assert.equal(pending.matched.length, 1);
  assert.equal(pending.matched[0].saved.offset, 8);
  const all = await vm.runInContext("openUpload([...selected].reverse(), batch.id, true)", ui);
  assert.equal(all.matched.length, 3);
  assert.equal(all.matched[0].file.name, "one.jpg");
  await assert.rejects(vm.runInContext("openUpload([selected[0]], batch.id, true)", ui), /selection did not match/i);
  batch.state = "queued";
  const queued = await vm.runInContext("openUpload([selected[2]], batch.id, true)", ui);
  assert.equal(queued.matched.length, 0);
  assert.deepEqual(requests, Array(4).fill(["/api/batches/test-batch", "GET"]));
}

Promise.all(sources.map(verify)).then(() => {
  console.log("Resume picker, exact matching, saved offsets and no duplicate batch creation passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
