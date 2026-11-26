const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

async function verify() {
  const python = process.env.PYTHON || "python";
  const photo = spawnSync(python, ["-c", 'import sys; sys.path.insert(0, "tests"); from test_studio import fixture; sys.stdout.buffer.write(fixture(25))']);
  assert.equal(photo.status, 0, photo.stderr?.toString());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.MOE_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.MOE_STUDIO_TEST_URL || "http://127.0.0.1:8787");
    await page.locator("#photos").setInputFiles({
      name: "pilot-unit-" + Date.now() + ".jpg", mimeType: "image/jpeg", buffer: photo.stdout
    });
    await page.locator("#cards .card").first().waitFor({ timeout: 25000 });
    await page.locator("#cards .card").first().click();
    await page.getByLabel("Listing title").fill("Pilot workbench accessory");
    await page.getByLabel("Asking price ($)").fill("45.00");
    await page.getByLabel("Buyer description").fill("Blue workbench accessory with a rounded housing.");
    await page.getByLabel("Condition is accurate for this item").check();
    await page.getByLabel("Product and photo grouping are correct").check();
    await page.getByLabel("Gallery shows the actual item and has no private labels").check();
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByText("Changes saved.").waitFor();
    await page.getByRole("button", { name: "Approve saved draft" }).click();
    await page.getByText("Approved. Find this draft in Channels.").waitFor();
    await page.getByRole("button", { name: "Close editor" }).click();
    await page.getByRole("button", { name: "Channels" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Pilot workbench accessory/ }).first().click();
    assert.equal((await download).suggestedFilename(), "crazy-moe-storefront.zip");
    assert.equal(await page.evaluate(() => document.body.scrollWidth), 390);
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Inventory" }).click();
    await page.getByRole("button", { name: /Pilot workbench accessory/ }).first().waitFor();
    console.log("Studio browser upload-to-download smoke passed.");
  } finally {
    await browser.close();
  }
}

verify().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
