# Account-specific posting queue

The `/posting.html` screen prepares copies of active Facebook inventory for another seller account. It does not modify source listing fields, publish automatically, alter photo metadata, or claim to defeat duplicate detection.

## Workflow

1. Sign in to Studio and open **Post to another account**.
2. Add the destination's display name and numeric profile ID. **Read signed-in Facebook account** can read it from the account already signed into this Chrome profile. Switch to the intended destination first.
3. Select up to 50 eligible active listings. Missing description, condition, price, or archived public photos excludes a listing.
4. Review editable refreshed titles/descriptions and choose a cover photo. The first release uses conservative paragraph and heading changes, not a generative AI rewrite; source facts are retained. Prices and conditions are taken from source records server-side.
5. Save the batch. Start the next product to open and fill a Facebook item form through Commerce OS 68.1.21.
6. Check category/location and publish in Facebook. Record the new listing URL in Studio, then start the next product. Publication is recorded as `submitted`; only a separate matching destination observation can upgrade it to `live`.

## Guarantees and limitations

- Copies are keyed by authenticated owner, source inventory ID, and destination account. Their status is separate from the legacy source listing status.
- Current-user identity must match the destination numeric Facebook profile ID before field entry, before photos, and after attachment. Unreadable/ambiguous identity stops the operation.
- Source availability and content digest are checked at preparation, claim, and immediately before filling. An inventory-change trigger cancels pending copies or flags existing/possibly published copies for removal.
- Account row locking permits one unfinished draft per destination; failed transfers require explicit retry after inspecting the Facebook tab. Timeouts and failures never imply publication.
- Fifteen-minute bearer capabilities are scoped to one copy, stored only in worker execution, and revoked on completion. Only the service role may redeem them through the dedicated endpoint. Normal RPCs require an enabled Studio member and ownership. Public RPCs are invoker wrappers around private implementations; no public posting RPC is SECURITY DEFINER.
- Images must be selected from that source's archived public listing-images bucket. Originals are untouched. The existing verified native photo-upload path is reused.
- Category and pickup location still require review in Facebook. Destination observation depends on the existing sync workflow being configured for that account; saving a link is not proof of live publication.
- Full unattended posting, an account-independent guarantee against duplicate flags, and automatic removal from another Facebook account are not included.

## Files and verification

- Database: `migrations/account_posting_queue.sql`, `migrations/account_posting_serial_queue.sql`, `migrations/account_posting_private_functions.sql`, and `migrations/account_posting_service_access.sql`.
- Edge function: `account-handoff/index.ts` (`studio-account-handoff`). JWT gateway checking is disabled because the function authenticates a scoped expiring transfer capability itself.
- UI: `web/posting.html`, `web/posting.js`, `web/posting.css`, `web/posting-copy.js`.
- Extension: `extension/account_queue_worker.js`; guarded installer `extension/install_account_queue.py` preserves the installed 68.1.20 cloud-auth/gallery modules.
- Tests: `node --test --test-name-pattern='refresh|missing|profile|account gate|wrong destination' cloud-studio/web/test_posting.cjs`; `python cloud-studio/web/test_posting_ui.py` (isolated headless Edge, mocked network); `test_account_posting.sql` (transactional rollback fixtures).

Acceptance on November 7, 2026: five JavaScript unit tests passed; browser workflow passed at 390px and 1280px without horizontal overflow or JavaScript errors; database integration transaction passed, with all fixtures rolled back. A real transfer on the second account remains pending its selection/sign-in and extension reload. No Facebook listings were published during implementation.
