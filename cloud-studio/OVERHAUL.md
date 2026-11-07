# Studio workspace and media integrity

Production Studio uses Supabase as its authoritative listing store. The office
SQLite/JSON system remains an intake and recovery fallback; it is not a second
writer to the production seller fields. Local research deltas require explicit
reconciliation and must not overwrite cloud seller edits.

## Data and mutation boundaries

| Concern | Store | Allowed writer |
| --- | --- | --- |
| Inventory identity | inventory | verified intake/import |
| Identification and confidence | product_identity, field_proposals | research/import proposals; no seller-field overwrite |
| Catalog facts, sources and dates | catalog_entries, catalog_evidence, research_evidence | evidence tools and authenticated member commands |
| Saved title, price, condition, description, private notes | listing_authoring, field_provenance, listing_revisions | revision-checked seller patch/rollback |
| Generated public-copy suggestions | generated_copy | import or explicit member refresh; application requires seller action |
| Originals | private photo_assets, studio-originals | upload gateway verifies SHA-256 and size |
| Manufacturer reference files | reference_assets | verified reference import/upload |
| Ordered buyer-facing selection | photo_selection, photo_choices, photo_changes | member selection/save or authenticated add-photo gateway |
| Prepared JPEGs | export_sets and private exports | renderer/manual conversion with verified receipts |
| Approval and handoff | approval_events, handoffs | member approval bound to exact revision, content and ordered JPEGs |
| Observed publication/account queues | observed listings and posting commands | separate explicit account workflow; no inferred publication |

The original bytes are retained before manual conversion. Reference promotion
reuses the existing reference identity, adds a prepared JPEG, and preserves the
existing cover and seller fields. Appending cannot convert an incomplete earlier
export set into a falsely verified gallery. Selection is limited to ten at the
UI, API and database boundaries. All URLs remain private and expire.

## Failure prevention

Signed-URL caching respects the server expiry, shares in-flight requests and
refreshes once on failed image decoding. Empty selections show an explicitly
labelled reference preview when one exists; never silently mark it selected.
`studio_media_audit()` reports storage/reference/selection/preparation readiness.
`studio_render_status()` and approval checks consult actual object metadata.
Approval and ZIP export additionally download and hash-check exact ordered JPEGs.

The workspace provides queue/grid views, search, derived category filters,
readiness metrics, an inline gallery and persistent actions. Seller text and photo
reordering can be saved together. A manufacturer image can be cover. No second
approval confirmation is introduced. A selected-product action reports each
failure and continues the remaining products. Bulk operations include gallery
preparation, explicit approval, source-backed missing-price fill, copy suggestions,
and approved ZIP download. The existing account posting workflow is retained.

Copy refresh is conservative deterministic cleanup of existing text, not fresh
AI product research. It records the original and removed internal text privately,
keeps damage/incompleteness/untested disclosures, and leaves saved fields intact.
Missing-price fill requires a dated recorded retail price and source and proposes
50% of that reference. It does not invent a market average or overwrite an
existing seller value/explicit blank.

A reconnecting new-product upload retains its idempotency key in session storage;
only hashes and the batch ID are stored there. Reselecting the same files after
reload can resume that batch. This is not a complete offline upload queue.

## Validation

- Node: `node --test cloud-studio/web/test_media_cache.cjs cloud-studio/web/test_workflows.cjs cloud-studio/web/test_render_status.cjs cloud-studio/render-worker/test.mjs cloud-studio/extension/test_member_session.cjs`
- Python seller/legacy tests: `python -m unittest discover -s cloud-studio -p 'test_*.py' -v`
- Browser: install Playwright Chromium and Pillow, then run `python cloud-studio/web/test_workspace.py`. It intercepts all network traffic and uses synthetic inventory, including two viewport sizes, combined seller/photo saves, partial bulk approval and verified ZIP contents.
- Installed extension: `python cloud-studio/extension/test_transfer_browser.py PATH_TO_EXTENSION`. It uses isolated Studio/Facebook fixtures and verifies two distinct drafts, hashes and existing-draft preservation. It does not publish or establish live Facebook acceptance.
- SQL integration: run the rollback-wrapped test_authoritative_core, test_media_integrity, test_copy_suggestions, test_edit_verified_photos, test_intake_render and render-status/retry tests through an administrator session. All mutations are rolled back.

## Deployment and recovery

Migrations in this increment: `media_integrity.sql`, `copy_suggestions.sql`,
`selection_limits.sql` (in that order). Existing production schema is required.
Deploy `api/index.ts` to studio-api, preserving its explicit JWT/member checks.
The Vercel file bundle includes all web assets, `/app/index.html`, renderer.py,
api/render.py, api/process_render.py, requirements.txt, Python 3.12 and the existing
120-second function configuration. Never omit posting or rendering files when
updating the frontend.

Production source had diverged from the Git branch. The verified live web source
was reconciled first before this increment. Future deployment manifests should
be generated from the committed source and compared against served bytes.
A frontend rollback does not undo additive migrations or seller edits. Restore
seller data only through versioned recovery; do not replace the database blindly.

## Explicit remaining acceptance gaps

- Retailer capture on current live discontinued-page layouts is not newly
  accepted by the isolated handoff test.
- Physical phone upload and office-unavailable/offline operation require real
  device acceptance; responsive emulation is not that evidence.
- Local/cloud historical deltas and unassigned originals need a dedicated
  reconciliation adapter; no automatic local writeback is enabled.
- Full independent Auth/cross-project restore is not established by a verified
  backup receipt or transaction tests.
- Automatic new manufacturer research, supported market-average pricing and
  photo grouping remain evidence-dependent workflows.
- Missing actual product photographs cannot be replaced with a mismatched model
  image. Such products stay visibly in Photo repairs.

## Bulk approval and selected-review repair — November 7, 2026

Bulk approval now persists the same displayed prefills as the individual editor.
Saved seller fields and explicit blanks take precedence. Production inspection
found 23 review items showing unsaved candidate titles and 5 showing unsaved
candidate descriptions; the old bulk action only persisted the New condition.
Each operation now reports a result per item and continues after individual
failures. Photo hashes, positive-price checks and server revision checks remain.

Review selected snapshots item IDs independently of the current filter. Approve
advances to the next selected item and only closes after the last one. A visible
item counter, Save & next, Skip and close/Escape reset were verified, including
mobile controls. Failed approvals keep the item open; skipped items stay selected.

Regression command: `python cloud-studio/web/test_bulk_review.py`. Strict isolated
Chromium tests passed at 1366x768 and 390x844, along with the existing workspace
suite. A rolled-back production database test confirmed two affected listings
can approve after matching prefills while preserving their prices/descriptions.
No live listings were left approved by these tests.
