# NGK approved-product console — 68.1.25

After posting an approved product on Facebook, the seller clicks **Confirm posted & load next** in the floating console. The extension saves the seller confirmation in Studio, removes the item from the approved queue, opens a new Facebook item form, and loads the next approved product with its verified photos. No return to Studio is required between products. **Already listed & load next** confirms a selected product that was posted earlier. Facebook's Publish button remains a manual seller action.

The console remains available on Marketplace pages after a tracked tab navigates away from the creation form. Its current item and revision come from extension session storage, not page-supplied IDs. Unrelated Marketplace tabs do not show the confirmation console. The product list collapses while a product is assigned, keeping the primary action visible.

## Implementation

`approved_picker_worker.js` uses the existing member session and `studio_state`, `studio_issue_handoff`, and `studio_confirm_published` RPCs. Confirmation requires an exact current revision and approved status. The existing backend records `confirmation_type: seller_report` and `facebook_url_verified: false`; it does not claim independently observed publication. Repeat confirmations are idempotent.

The extension stores tab context only after it has an identified approved handoff, marks the load complete only after verifying fields, condition and photo count, and ties confirmation to that loaded item. It saves confirmation before requesting the next item. The next tab's ID is retained so repeated clicks focus the existing next tab. A single advancement lock and exclusions for already assigned products prevent automatic duplicate drafts. An empty queue opens no extra tab. Failed next-tab creation preserves the saved confirmation, and failed filling offers **Retry on new form**, preserving the partial draft.

The picker still displays the full current approved list and supports manually loading a selected approval into an empty Facebook form. Origin, extension ID and top-frame validation restrict requests. Blank-form checks before/after handoff issuance and before filling preserve typed drafts. Tokens and full private Studio state remain in the background worker. Photo staging and cleanup use the existing native uploader.

This release broadens only the existing content script's URL match from Marketplace creation pages to Marketplace pages, with a tracked-tab gate. It adds no extension permission and changes no gallery, account-posting, photo-variation, website or database implementation.

## Validation

- 18 Node tests cover nine-item queue exposure, sender restrictions, blank/changed forms, exact handoffs, field/photo validation, explicit confirmation before advance, stale revisions, double clicks, final-item completion, Already listed, next-tab failures, occupied drafts, post-navigation confirmation and automatic-fill failure recovery.
- Isolated headless Edge fixtures at 390px and 1440px cover selection, confirmation, count reduction, sign-in recovery, no overflow or JS errors, and no obsolete pairing prompt. Separate selling-page fixtures verify that tracked tabs retain the confirmation control and unrelated tabs hide the console. All network is intercepted; no live Facebook account is used.
- A database transaction under the authenticated member role verified required explicit confirmation, stale-revision rejection, one seller-report audit event and idempotency. It rolled back. A separate query confirmed all nine products remained approved.

## Installation and activation

`install_approved_picker.py` upgrades the exact NGK 68.1.24 files to 68.1.25, verifies preimage hashes and JavaScript syntax, and backs up the prior files to `pre-posting-loop-68.1.24` beside the extension folder. It preserves concurrent changes by refusing unexpected inputs.

After installation, reload Commerce OS at `chrome://extensions`, refresh the signed-in Studio tab in the same Chrome profile if reconnection is needed, and refresh Facebook. Browser reload/activation and real Facebook acceptance must be verified separately from the on-disk install. No listing is published or marked as listed during installation. Session context survives service-worker suspension and page navigation, but ends when Chrome's extension session storage is cleared; an earlier actual post can then be marked with **Already listed & load next**.
