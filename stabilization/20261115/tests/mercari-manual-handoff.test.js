'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const studio = 'http://localhost:8787';
const backend = 'https://sfheqjnxlkygjfohoybo.supabase.co';
const sourceDir = path.join(__dirname, '../live-vercel/src');
const photos = ['cover', 'detail'].map(name => ({ url: backend + '/storage/v1/object/test/' + name }));
const draft = {
  title: 'Fixture amplifier',
  description: 'Working amplifier with remote.',
  price: '123.45',
  condition: 'Good',
  brand: 'Fixture brand',
  category: 'Electronics › Home audio',
  shipping: { payer: 'buyer', weight_oz: '24', length_in: '12', width_in: '8', height_in: '6' },
  photos,
};
const item = {
  id: 'legacy-item', revision: 7, source_kind: 'studio', source_id: 'fixture',
  source_snapshot: { fields: { price: '100', description: draft.description }, photos, identity_status: 'verified_exact' },
  draft, state: 'handed_off', available: true, eligible: true, readiness: { ready: true },
};
const postedUrl = 'https://www.mercari.com/us/item/m100/';
const posted = { ...item, id: 'posted-item', state: 'posted', listing_url: postedUrl, draft: { ...draft, title: 'Already posted' } };
const next = { ...item, id: 'next-item', state: 'ready', draft: { ...draft, title: 'Another fixture' } };
const rowQueue = [item, posted, next];
const calls = [];

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.MERCARI_TEST_CHROMIUM || undefined });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route(studio + '/**', async route => {
      const filename = new URL(route.request().url()).pathname.slice(1);
      if (filename === 'auth.js') {
        return route.fulfill({ contentType: 'text/javascript', body: `
          globalThis.studioAuth = { auth: {
            initialize: async () => {},
            getSession: async () => ({data:{session:{access_token:'fixture'}}}),
            onAuthStateChange: () => {},
          }};
        ` });
      }
      return route.fulfill({ path: path.join(sourceDir, filename) });
    });
    await context.route(backend + '/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const headers = { 'access-control-allow-origin': '*' };
      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: {
          ...headers, 'access-control-allow-headers': 'apikey, authorization, content-type',
        } });
      }
      if (pathname.startsWith('/storage/')) {
        const marker = pathname.endsWith('/cover') ? 1 : 2;
        return route.fulfill({ body: Buffer.from([255, 216, 255, marker]), headers });
      }
      const name = pathname.split('/').at(-1);
      const args = request.postDataJSON();
      calls.push({ name, args });
      const results = {
        studio_mercari_state: { queue: rowQueue, presets: [] },
        studio_mercari_catalog: { enabled: false, choices: [], research: [] },
        studio_mercari_categories: { paths: [] },
        studio_mercari_inventory: { items: [], total: 0 },
        studio_facebook_import_status: [],
      };
      if (name === 'studio_mercari_update' && args.p_action === 'download') {
        assert.equal(args.p_id, item.id);
        assert.equal(args.p_revision, item.revision);
        return route.fulfill({ json: item, headers });
      }
      if (name === 'studio_mercari_update' && args.p_action === 'posted') {
        assert.equal(args.p_id, item.id);
        assert.equal(args.p_revision, item.revision);
        item.state = 'posted';
        item.listing_url = args.p_url;
        return route.fulfill({ json: item, headers });
      }
      assert.ok(Object.hasOwn(results, name), 'Unexpected RPC ' + name);
      return route.fulfill({ json: results[name], headers });
    });
    await context.route('https://www.mercari.com/**', route => route.fulfill({ body: 'Native Sell fixture' }));
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(studio + '/mercari.html?queue=' + item.id);
    await page.getByRole('heading', { name: draft.title }).waitFor();
    assert.equal(await page.locator('#item-state').textContent(), 'Ready for manual listing');
    assert.equal(await page.locator('input[name="price"]').inputValue(), '123.45');
    assert.equal(await page.locator('#photos input').first().isDisabled(), true);
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#download-pack').click()]);
    assert.equal(file.suggestedFilename(), 'CrazyMoe-Mercari-studio-fixture.zip');
    const archive = await fs.readFile(await file.path());
    assert.ok(archive.includes('Working amplifier with remote.'));
    assert.ok(archive.includes(Buffer.from([...Buffer.from('photos/01.jpg'), 255, 216, 255, 1])));
    assert.ok(archive.includes(Buffer.from([...Buffer.from('photos/02.jpg'), 255, 216, 255, 2])));
    const [sell] = await Promise.all([page.waitForEvent('popup'), page.locator('#open-sell').click()]);
    await sell.waitForLoadState();
    assert.equal(sell.url(), 'https://www.mercari.com/sell/');
    await sell.close();
    assert.ok(!calls.some(({ args }) => args.p_action === 'posted'));

    await page.locator('#listing-url').fill(postedUrl);
    await page.locator('#done-next').click();
    await page.getByText('This Mercari link is already recorded for another item in your queue.', { exact: true }).first().waitFor();
    assert.ok(!calls.some(({ args }) => args.p_action === 'posted'));
    await page.locator('#listing-url').fill('https://www.mercari.com/us/item/m200/?ref=test');
    await page.locator('#done-next').click();
    await page.getByRole('heading', { name: 'Another fixture' }).waitFor();
    assert.equal(item.listing_url, 'https://www.mercari.com/us/item/m200/');

    await page.locator('#queue-filter').selectOption('posted');
    await page.getByRole('button', { name: /Fixture amplifier/ }).click();
    assert.equal(await page.locator('#open-sell').isVisible(), false);
    assert.equal(await page.locator('#download-pack').isDisabled(), true);
    assert.deepEqual(pageErrors, []);
    console.log('Mercari manual handoff browser test passed');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
