# NGK approved product selector — 68.1.24

The home-PC panel exposed an older single-item/private-bridge flow with no inventory selector and a stale pairing-code prompt. The cloud inventory contained nine approved products, but the panel could not display them. This patch reads the same current approved inventory as Studio and lets the owner choose a product directly on a blank Facebook item form.

The panel automatically loads the list, displays the approval count, and offers **Load selected product**, **Refresh approved**, and **Open Studio / sign in**. A draft explicitly opened from Studio retains its separate **Load opened Studio draft** action. The popup replaces the pairing-code controls with **Check Studio connection**. No new pairing credentials or permissions are added.

`approved_picker_worker.js` authenticates through the existing Studio member session, retrieves `studio_state`, and exposes only active approved IDs, revisions, titles, prices, conditions and photo counts to the extension panel. Selection requests a fresh `studio_issue_handoff` for the exact item/revision and reuses the native uploader from `ngk_cloud_worker.js`. The backend revalidates exact approval/photo state. The full Studio payload and authentication tokens never reach the Facebook content script.

Request origin/frame/extension checks, per-tab locks, blank-form checks before and after handoff issuance and immediately before filling, and existing-assigned-draft checks prevent accidental overwrites and repeated clicks. Filling verifies fields, condition and attached photo count. It does not change approval or publication status and does not publish. Existing account-posting/photo-variation and gallery modules are preserved.

## Validation

- Nine Node tests passed: all nine rows and private-field exclusion, sender restrictions, exact selection, existing/changed drafts, stale approvals, assigned handoffs, double clicks and native file cleanup.
- Isolated headless Edge tests at 390px and 1440px displayed nine fixture approvals, selected the ninth correctly, verified the blank-form detector, recovered after sign-in errors, and contained no pairing prompt, JS errors or overflow. The synthetic Facebook page intercepted all network; no user browser session was accessed.
- A live database transaction using the authenticated member role reported `approved_products=9` and `all_approved_handoffs_ready=true`. The transaction rolled back, including all temporary handoffs; no approvals changed.
- Version 68.1.24 installed on disk on DESKTOP-NGK53N6 using exact preimage hashes. Backup: `pre-approved-picker-68.1.23` beside the extension directory. No website deployment or database migration required.

## Activation and remaining acceptance

Reload Commerce OS at `chrome://extensions`. Refresh the signed-in Studio page in the same Chrome profile to reconnect its in-memory session, then refresh the blank Facebook item form. The panel should show the current approved count and a scrollable list. The code can report a missing Studio session, rather than sending the owner to an unavailable pairing-code screen.

Actual display/attachment in the owner's current Facebook session remains unverified because this session did not expose the local-browser control tool. Installation on disk is not reported as browser activation. No Facebook listing was published.
