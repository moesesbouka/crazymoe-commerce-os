# Account-specific posting queue

The `/posting.html` screen prepares copies of active Facebook inventory for another seller account. It does not modify source listing fields, publish automatically or claim to defeat duplicate detection.

## Workflow

1. Sign in to Studio and open **Post to another account**.
2. Add the destination's display name and numeric profile ID. **Read signed-in Facebook account** can read it from the account already signed into this Chrome profile. Switch to the intended destination first.
3. Select up to 50 eligible active listings. Missing description, condition, price, or archived public photos excludes a listing.
4. Review automatically refreshed titles/descriptions and the framed cover preview. Editing or changing the cover is optional. The first release uses conservative paragraph and heading changes, not a generative AI rewrite; source facts are retained. Prices and conditions are taken from source records server-side.
5. Click **Prepare photos & save batch**. Every selected photo is fetched, decoded, rendered, and source-hash checked before the batch is saved. Start the next product to fill a Facebook item form through Commerce OS 68.1.22.
6. Check category/location and publish in Facebook. Record the new listing URL in Studio, then start the next product. Publication is recorded as `submitted`; only a separate matching destination observation can upgrade it to `live`.

## Guarantees and limitations

- Copies are keyed by authenticated owner, source inventory ID, and destination account. Their status is separate from the legacy source listing status.
- Current-user identity must match the destination numeric Facebook profile ID before field entry, before photos, and after attachment. Unreadable/ambiguous identity stops the operation.
- Source availability and content digest are checked at preparation, claim, and immediately before filling. An inventory-change trigger cancels pending copies or flags existing/possibly published copies for removal.
- Account row locking permits one unfinished draft per destination; failed transfers require explicit retry after inspecting the Facebook tab. Timeouts and failures never imply publication.
- Fifteen-minute bearer capabilities are scoped to one copy, stored only in worker execution, and revoked on completion. Only the service role may redeem them through the dedicated endpoint. Normal RPCs require an enabled Studio member and ownership. Public RPCs are invoker wrappers around private implementations; no public posting RPC is SECURITY DEFINER.
- Images must be selected from that source's archived public listing-images bucket. Originals are untouched. The native photo-upload adapter receives generated JPEG files, with source hashes, dimensions, order and export hashes recorded as evidence. Missing photos and source-byte changes stop the transfer. Browser tests simulate the Facebook adapter; real second-account attachment remains an acceptance gate.
- Category and pickup location still require review in Facebook. Destination observation depends on the existing sync workflow being configured for that account; saving a link is not proof of live publication.
- Full unattended posting, an account-independent guarantee against duplicate flags, and automatic removal from another Facebook account are not included.

## Files and verification

- Database: `migrations/account_posting_queue.sql`, `migrations/account_posting_serial_queue.sql`, `migrations/account_posting_private_functions.sql`, and `migrations/account_posting_service_access.sql`, and `migrations/account_photo_variants.sql`.
- Edge function: `account-handoff/index.ts` (`studio-account-handoff`). JWT gateway checking is disabled because the function authenticates a scoped expiring transfer capability itself.
- UI: `web/posting.html`, `web/posting.js`, `web/posting.css`, `web/posting-copy.js`; shared photo renderer `web/posting-photo.js`.
- Extension: `extension/account_queue_worker.js`; guarded photo upgrade `extension/install_account_photos.py` upgrades installed 68.1.21 to 68.1.22 without touching background/gallery/auth modules. The original installer remains for the 68.1.20→68.1.21 prerequisite.
- Tests: `node --test --test-name-pattern='refresh|missing|profile|account gate|wrong destination' cloud-studio/web/test_posting.cjs`; `python cloud-studio/web/test_posting_ui.py` (isolated headless Edge, mocked network); `test_account_posting.sql` (transactional rollback fixtures).

## Automatic photo treatment

`alt-frame-v1` adds an 18–34px charcoal frame, rounded outer corners, a 34px light footer, and a small inventory reference in that footer. Frame thickness is deterministic for destination/source/photo. It preserves the entire photograph, with no clipping, mirroring, pixel noise, or alteration of visible defects or labels. Images are downscaled only when needed to fit within 1600px and exported as JPEG quality 0.94. A truthful EXIF UserComment identifies the source and presentation variant; source camera/GPS metadata is not copied into the derived JPEG. No claim is made about defeating platform duplicate detection.

Studio previews and the extension use the same dependency-free renderer. Studio saves the original URLs, SHA-256 of each source, dimensions, order, and recipe version. Derived files are recreated on demand instead of adding permanent duplicate copies to storage. The extension rechecks source bytes before rendering and supplies actual generated-file hashes when reporting a filled draft. Old clients cannot report an enhanced batch as filled without matching photo evidence. Old unframed queue records remain backward compatible.

## Verified acceptance — November 7, 2026

- Eight JavaScript tests passed: source facts, account checks, geometry limits, invalid inputs, and EXIF structure.
- Isolated Edge browser tests passed at 390px and 1280px with actual decoded JPEG fixtures, framed previews, order preservation, correct photo manifests, wrong extension-version rejection, missing-photo save failure, and no JavaScript errors or horizontal overflow.
- The real account worker executed against a simulated Facebook/native-file adapter. Two generated JPEGs were staged, their EXIF and output hashes independently read, and a changed-source transfer was rejected. A separate Web Worker produced the same JPEG as the page renderer in that browser.
- A read-only test transformed one real archived inventory image. The JPEG decoded and its hash, dimensions, and EXIF verified; no source file or listing was modified.
- Database integration transaction passed including invalid/missing manifests, old-extension evidence, mismatched hashes, permissions, claim/replay guards, publication state and sold-source handling. Fixtures rolled back; no destination accounts or queue records created.
- Extension 68.1.22 is installed on disk on NGK, with a 68.1.21 backup. Chrome reload remains required.
- A real transfer on the second account remains pending its selection/sign-in and extension reload. No Facebook listings were published. Destination availability observation and unattended publishing are unchanged.

Run `node --test cloud-studio/web/test_posting.cjs cloud-studio/web/test_posting_photo.cjs`, `python cloud-studio/web/test_posting_ui.py`, and transactional `test_account_photos.sql`. The optional `web/test_posting_photo_real.py` smoke test reads a known archived product URL and never opens Facebook.
