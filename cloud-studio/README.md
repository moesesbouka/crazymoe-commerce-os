# Current implementation

See [OVERHAUL.md](OVERHAUL.md) for the current architecture, mutation boundaries, tests and remaining acceptance gaps. The following is the historical migration log; its checkpoint statements describe earlier releases.

# Existing Studio cloud migration

This directory extends the existing CrazyMoe Commerce OS project. It is not a
replacement storefront and is not a deployed cloud Studio.

The owner directive is now: retain crazymoe.com, migrate the existing office
Studio to authenticated studio.crazymoe.com and studio.crazymoe.com/app, and make
all essential workflows work with every office computer unavailable. Reuse the
existing Supabase and Vercel resources where appropriate. Keep the office system
available until full acceptance. No purchases, subscriptions, public inventory,
public original photos, Facebook publication or customer messages are authorized.
The owner subsequently approved the existing Supabase organization's Pro upgrade;
the upgraded plan has been verified. Other paid purchases still require approval.

## Implemented checkpoint

- `legacy/` preserves the existing office application's listing persistence,
  public copy and revision-bound approval logic. These are reference modules,
  not a PostgreSQL adapter. Their SQLite and local-file dependencies still need
  migration; in particular manufacturer image fingerprints currently read paths.
- `migrations/private_archive.sql` creates an isolated, append-only migration
  evidence store. It is not an operational inventory database. There are no
  grants to anonymous, authenticated or service-role clients.
- `restore_archive.py` verifies content hashes and reconstructs NEW SQLite files
  from archived schema/rows. It refuses overwrites and compares every archived
  data row after restoration. SQLite internal sequences are regenerated, not
  preserved byte-for-byte. Existing source SQLite backups remain available.
- `test_migration_safety.py` exercises the existing seller-edit protections,
  conflicts, explicit clears, rollback, approval snapshots and tamper rejection.
- `migrations/authoritative_core.sql` defines the private operational model:
  inventory, identity, catalog, manifest/research evidence, protected saved fields,
  generated candidates, ordered photos, immutable approvals/revisions, proposals
  and a durable job table. A job table is not a running cloud worker.
- `migrations/import_preserved_snapshot.sql` imports the archived snapshot without
  merging generated candidates into saved listing fields or activating historical
  approvals. Set `studio.migration_batch` explicitly within its transaction.
- `migrations/authenticated_api.sql` exposes narrow authenticated RPC commands.
  Enabled Studio membership is checked inside each private definer function.
  Clients have no direct table grants. `api/index.ts` verifies JWTs using Auth
  before those commands and signs only verified original-photo assets.
- `test_authoritative_core.sql` exercises membership rejection, optimistic
  concurrency, explicit clears, seller provenance, approval invalidation and
  append-only rollback in a transaction that rolls back all test changes.
- `photo_migration/index.ts` is a bounded migration endpoint template. Supply a
  private `migration-config.json` with `token_sha256`, `expires_at` (epoch ms) and
  `allowed` (SHA-256 to byte-size map). It accepts only exact manifest content,
  never overwrites objects, expires automatically, and can be closed explicitly.
  The sender must download every uploaded object and verify SHA-256 and size;
  bucket object counts alone are insufficient evidence of successful migration.

The private core, snapshot import and authenticated API are deployed as an
additive foundation. All originals and preserved manufacturer-reference files
in the captured snapshot have completed upload, download and SHA-256/byte-size
verification. Their receipts are archived privately. Both temporary import
endpoints were replaced with permanently closed responses after completion.
The source office application has not been switched to these APIs. A fresh delta
comparison is required before cutover because office editing remains active.

`finalize_photo_receipts.sql` refuses incomplete receipts or storage mismatches
before marking originals verified. That rejection path was exercised against
the deployed database with test changes rolled back. `private_reference_assets.sql`
and `import_reference_receipts.sql` preserve manufacturer associations separately;
all selected manufacturer entries resolve to verified cloud files. This does not
establish product identity or approve those images for publication.

`legacy/ui/` preserves the existing Studio HTML, CSS and JavaScript for adaptation.
The direct Create Facebook Listing link was also added to the office HTML after
a hash-verified backup. No Facebook publication was performed. Browser rendering
remains unverified because the workspace browser installation failed.

Validated: legacy Python regression suite (8 tests), deployed core integration
assertions, owner-scoped SQL read, and live API rejection of anonymous requests
(401), invalid tokens (401), and unapproved browser origins (403). SQL claims
simulation is not a real browser login test. The copied database archive was
restored and its complete row contents compared against the archived source.
Three original samples were additionally downloaded and hash-checked directly
from the independent cloud workspace without office networking. This verifies
sample storage access, not independent operation of the complete application.

New private tables deliberately have RLS with no client policies and no table
grants: owner-checked commands are the only client interface. Security advisories
in the existing public application schema remain outside this additive migration
and must be investigated before declaring the overall platform secure.

Run `python -m unittest discover -s cloud-studio -p 'test_*.py' -v`.

## Required authoritative model

Separate physical inventory IDs and identity from catalog facts, manifests and
evidence, AI proposals/confidence, seller-authored fields, generated public copy,
ordered photo selections, and approval/publication events. Preserve all legacy
IDs and payloads. Unknown historical authorship must stay unknown; protect its
saved values without asserting seller authorship. Workers may propose changes
but cannot overwrite protected seller fields. Version-bound atomic writes must
reject stale editors. Rollback appends an event; it does not erase history.

Approval must bind exact customer-facing fields and actual JPEG content/order.
An old approval record without matching immutable evidence must be retained as
historical evidence, never silently upgraded to a current approval.

## Execution phases and gates

1. Audit live source, data, backups, tests and existing cloud permissions.
2. Configure private PostgreSQL, authentication, private originals, API and
   durable cloud jobs with retries, idempotency, bounded concurrency and logs.
3. Import preserved IDs/data/provenance/history/photos and verify counts/hashes.
4. Adapt the existing Studio/mobile UI to the cloud backend; retain fast
   navigation, Save & Next, grouping, editing, approvals and offline upload queue.
5. Move identification, research and copy generation to cloud workers; keep
   evidence separate from listing copy and require exact-model corroboration.
6. Update the existing Studio-connected extension, keeping Draft Builder as the
   fallback. Transfer approved revisions and JPEGs directly from the cloud.
7. Test real workflows, backup restoration, privacy and office-offline operation
   before cutover. Keep original URLs usable as the fallback until then.

Studio must visibly link Create Facebook Listing to
https://www.facebook.com/marketplace/create/item without publication. Test at
least two consecutive products with independent title/price/condition/copy/JPEGs.
Default condition remains New and the owner may change it. Remove the redundant
review checkbox; retain actual approval state. Suggested price starts at 50% of
supported retail evidence, never overwriting a seller price.

## Acceptance status

No operational cloud Studio, AI worker, mobile cloud upload, cloud extension
handoff, DNS cutover, or office-offline workflow is claimed by this checkpoint.
Frontend deployment alone is insufficient. Each acceptance item requires live
evidence, including negative permission tests and a real restoration exercise.

Independent recommendations should be compared with observed source and
behavior before adoption. Do not replace functioning components merely because
an external assessment proposes a rebuild.

## Rollback and sensitive data

The archive migration is additive and does not switch application reads/writes.
The office application therefore remains the active fallback. Retain the private
archive until owner-approved retirement; never drop it as routine rollback.
Keep snapshots, inventories, photos, credentials and audit evidence outside this
public repository. Deploy on a separate Studio target so storefront deployment
and DNS are not changed as a side effect.

## Cloud Studio preview

The isolated Studio project serves the adapted editor at
https://crazymoe-marketplace-studio.vercel.app/ and mobile intake at
https://crazymoe-marketplace-studio.vercel.app/app/. The team-qualified alias may
redirect to Vercel SSO. Chrome rendered the Studio sign-in form at 412px and
1440px on the short alias. Owner sign-in and a real Pixel upload still require
acceptance. The browser keeps credentials in memory for the open session.

The private mobile upload path accepts member-owned objects and verifies their
size and SHA-256 in a cloud function before committing the product and its
identification job. PostgreSQL schedules the cloud worker, leases one job at a
time, and records a proposal separately from seller fields. A real migrated
product completed the cloud visual research job on retry after an initial empty
model response. Model confidence is a suggestion. Retailer verification and
manufacturer sourcing require additional work.

The public storefront uses public_listings. Seven legacy tables now restrict
client access, and private inventory and administrative views require membership.
The storefront still loaded its listings and images in Chrome after the change.
The older Commerce OS extension still references active_listings directly.
Migrate that authenticated sync path before tightening its remaining grants.

Next acceptance gates include verified per-selection JPEG exports preserving
existing enhancement, ordering and style, revision-bound approval, two consecutive
Facebook drafts through the real Commerce OS extension, full restoration, source
delta reconciliation, and the custom-domain cutover. Keep the office fallback.
