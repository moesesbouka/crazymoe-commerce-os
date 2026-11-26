const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

async function verify() {
  const generate = spawnSync(process.env.PYTHON || "python", ["-c", [
    "import base64,json,sys",
    "sys.path.insert(0,'tests')",
    "from test_studio import fixture",
    "print(json.dumps([base64.b64encode(fixture(i)).decode() for i in range(64)]))",
  ].join("\n")], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(generate.status, 0, generate.stderr?.toString());
  const photos = JSON.parse(generate.stdout.toString()).map((image, i) => ({
    name: `pixel-resume-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(image, "base64"),
  }));
  const start = process.env.MOE_STUDIO_TEST_URL || "http://127.0.0.1:8787";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.MOE_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
    const first = await context.newPage();
    await first.goto(start);
    let uploads = 0;
    await first.route("**/api/batches/*/files/*", (route) => {
      uploads++;
      return uploads > 7 ? route.abort("internetdisconnected") : route.continue();
    });
    await first.locator("#photos").setInputFiles(photos);
    await first.getByText(/Upload stopped. Accepted chunks are saved/).waitFor({ timeout: 30000 });
    await first.getByText("7 received · 0 skipped · 57 pending").waitFor();
    const initial = await (await context.request.get(start + "/api/batches")).json();
    const batch = initial.find((row) => row.photos === 64);
    assert.ok(batch);
    await first.close();
    const second = await context.newPage();
    await second.goto(start);
    await second.locator("#photos").setInputFiles([...photos].reverse());
    const deadline = Date.now() + 30000;
    let receipt;
    do {
      receipt = await (await context.request.get(start + "/api/batches/" + batch.id)).json();
      if (receipt.files.every((file) => file.state === "accepted")) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert.equal(receipt.files.filter((file) => file.state === "accepted").length, 64);
    const final = await (await context.request.get(start + "/api/batches")).json();
    assert.deepEqual(final.filter((row) => row.photos === 64).map((row) => row.id), [batch.id]);
    console.log("64-photo browser test resumed the existing batch after interruption, tab close and reordered selection.");
  } finally {
    await browser.close();
  }
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
