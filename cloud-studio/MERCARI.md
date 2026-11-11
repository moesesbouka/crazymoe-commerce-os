# Mercari preparation desk

Open `https://studio.crazymoe.com/mercari.html`, or choose **Mercari desk** in Studio.
The page shares Studio's existing persisted sign-in; it does not require an office PC or extension.

1. Choose Studio products or imported active listings. Search, select up to 50 products, and prepare a batch. A source switch or new search clears hidden selections; selections can span pages.
2. The draft preserves the saved price and product facts, maps known conditions, recognizes explicitly named brands, and removes promotional sentences. Compare the original description inline. Category text is a starting point to confirm in Mercari's own category picker.
3. Review photo choices and shipping. Studio uses verified original warehouse photos from the seller's current selection, excluding manufacturer references. Imported photos require seller confirmation of ownership and actual-item content. Packed weight and dimensions are never guessed; saved shipping presets can be applied to a batch or one item.
4. Save the listing, download its ZIP, extract the ordered photos, and use the copy buttons beside Mercari's listing form. The ZIP is built in the browser; private originals are fetched through the existing member-authenticated media endpoint and verified against their recorded SHA-256 and byte count.
5. Publish in Mercari, paste the published item URL, and use **Save posted link → Next item**. Posted status records the seller's confirmation; it is not an independent Mercari verification. Marking sold affects this queue only and reminds the seller to update other live listings.

## Boundaries and persistence

- This release prepares listings and tracks progress. It does not fill, upload, publish, scrape, or synchronize sales inside Mercari. No paid integration is required.
- Queue records, shipping presets and immutable audit events live in private `studio_core` tables. Enabled membership is checked by private definer functions; public wrappers are invoker functions. Clients have no direct table grants. Queues and presets are scoped to the signed-in member.
- One queue record per member, source kind and source ID. Re-preparation never overwrites an existing draft. Cancelled records can be explicitly rebuilt. Records from distinct source IDs are not automatically assumed to represent the same physical item.
- Revision checks protect edits from another device. Source digests detect changes in source fields, photo choices and availability before saving, downloading or recording publication. Rebuilding explicitly replaces this Mercari draft's text and photos while retaining shipping; Studio authoring fields are preserved.
- Studio products with unverified physical identity stay in Needs details. Missing shipping, unknown conditions, excessive description length, and prices outside the supported general $1–$2,000 range also need attention. The desk does not guess missing facts or truncate defect descriptions.

## Validation

- `test_mercari_queue.sql`: deployed PostgreSQL transaction test, rolled back completely. Covers duplicate preparation, source-photo allowlists, manufacturer exclusion, optimistic revisions, source staleness, URL validation, posted/sold transitions, shipping validation, owner isolation, and client grants. Also verified reads through the real `authenticated` role.
- `web/test_mercari_dom.cjs`: real page scripts and HTML with synthetic API responses. Covers batch preparation, promotional-text removal preserving defects, shipping presets, saves, conflicts retaining edits, ZIP contents, dirty-edit publication link handling, next item, refresh, stale rebuild and logout.
- ZIP read back with Python `zipfile`: correct paths, valid CRCs and unchanged photo bytes.
- `web/test_mercari_ui.cjs`: Playwright story for 1440px and 390px, retained for an environment with Chromium support. This workspace's Chromium launch was blocked by its socket restriction; no successful responsive screenshot test is claimed.
- Production release preserves the previously deployed Studio, Facebook and rendering assets by their deployment file hashes, changing only entrypoint links and adding Mercari files. No Mercari listing is published during validation.

Run DOM tests with jsdom 26 installed on `NODE_PATH`:

```sh
node cloud-studio/web/test_mercari_dom.cjs
```
