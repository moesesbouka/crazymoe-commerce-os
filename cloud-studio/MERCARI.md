# Mercari preparation desk

Open `https://studio.crazymoe.com/mercari.html`, or choose **Mercari desk** in Studio.
The page shares Studio's existing persisted sign-in; it does not require an office PC or extension.

1. Choose Studio products or imported active listings. Search, select up to 50 products, and prepare a batch. A source switch or new search clears hidden selections; selections can span pages.
2. The draft preserves the saved price and product facts, maps known conditions, recognizes explicitly named brands, and removes promotional sentences. Compare the original description inline. Category text is a starting point to confirm in Mercari's own category picker.
3. Review photo choices and shipping. Studio uses verified original warehouse photos from the seller's current selection, excluding manufacturer references. Imported photos require seller confirmation of ownership and actual-item content. Packed weight and dimensions are never guessed; saved shipping presets can be applied to a batch or one item.
4. Save the listing, download its ZIP, extract the ordered photos, and use the copy buttons beside Mercari's listing form. The ZIP is built in the browser; private originals are fetched through the existing member-authenticated media endpoint and verified against their recorded SHA-256 and byte count.
5. Publish in Mercari, paste the published item URL, and use **Save posted link → Next item**. Posted status records the seller's confirmation; it is not an independent Mercari verification. Marking sold affects this queue only and reminds the seller to update other live listings.

## Boundaries and persistence

- The original preparation-only checkpoint is extended by the automatic handoff described below. The companion fills fields and attaches photos; final publication and carrier selection remain seller actions. No paid integration is required.
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

## Automatic form handoff (November 11 update)

The starting source is now **All active Facebook inventory**. The desk reads every
active imported record across all pages (1,071 at implementation), then searches,
sorts and paginates locally. This is the saved Facebook import, not a claim that a
fresh complete Facebook scrape has run. Products without a photo remain visible
with a placeholder. Grid and table views show cover, title, price, condition,
category and queue status.

**Open & fill Mercari** uses Crazy Moe Mercari Companion 2.0. The existing companion
files were updated on both NGK and B3A, with backups retained. Chrome must reload
the unpacked extension and grant the requested Mercari site access. The current
browser connection cannot operate Chrome's internal extension settings page.
Fresh installations can download `/mercari-companion.zip` from Studio.

Studio sends only the explicit queue draft and ordered image files through an
origin-checked content-script bridge. No Studio access or refresh token is sent
to the companion. The extension binds an expiring job to a newly opened Mercari
sell tab. It sets native React form values, follows exact category paths, selects
an exact brand if Mercari offers it, maps condition controls and attaches the files
in order. Complete packed-shipping presets populate Mercari's weight/dimension
picker and open the eligible service selection. The seller confirms the service
and who pays shipping, then clicks List. The companion never clicks List or Save
draft and refuses an already populated form.

187 distinct Electronics category paths were read directly from the live listing
picker and included as a verified initial catalog. Searchable selection, title
based suggestions and a batch category are available. **Import / refresh Mercari
categories** walks the actual visible category menu in a separate blank form,
including other departments, and merges the returned paths into a member-owned
private catalog. It does not invent category IDs or use hidden Mercari APIs.

After a real seller click on List, a bound-tab item URL observed within two
minutes can be recorded automatically. The existing inventory digest and queue
revision are checked before recording that confirmation. The next prepared item
can then open automatically. A changed listing, unavailable source or existing
Mercari draft stops the handoff instead of overwriting another item.

Validation adds a form fixture using the observed Mercari test IDs, exact category
buttons, brands, condition controls and file input. It checks file order and text
readback, existing-draft rejection and zero List/Save-draft clicks. The UI fixture
checks the default full inventory and cover/grid/table rendering. Live selectors
and category choices were inspected in the seller's signed-in Mercari form; a
full extension-driven production fill still requires the Chrome reload.
