# Existing photo recipe in cloud runtime

`renderer.py` accepts verified bytes and produces a 1600×1600 JPEG using the captured office algorithms. It preserves natural enhancement, guarded blur/branding, manufacturer-image handling, reviewed focus crops and optional Pop. Existing migrated exports must be served unchanged. The new cloud recipe version identifies seeded OpenCV execution and pinned libraries; it does not assert byte identity with historical Windows outputs or Windows fonts.

`office_recipe/` is the unmodified algorithm reference captured from the running office source. Tests compare JPEG bytes under the same runtime across six recipe combinations, check repeatability and reject unsafe inputs. Synthetic images only; no inventory photos are included.

`api/render.py` is an authenticated, read-only preview endpoint for a selected photo on a product that has no verified export set. It verifies membership through Studio, binds both revisions, downloads only a server-signed private source, verifies its hash and rechecks revisions after rendering. It refuses to replace existing exports. This endpoint does not store output, approve products or publish listings.

Run `python -m unittest discover -s cloud-studio/render -p 'test_*.py' -v` with requirements installed. Production integration still needs durable render jobs, verified private export registration, reviewed per-source crop metadata and UI acceptance. No renderer completion or office-independent workflow acceptance is claimed.

## Durable queue checkpoint

The deployed `studio_request_render`, `studio_render_claim` and `studio_render_finish`
functions reuse `studio_core.jobs`. Requests bind seller and photo revisions plus the
ordered source selection. Only current review items without existing verified exports
are eligible. Worker claims lease one job, retry up to three times and reject stale
attempts. Registration checks ordered source hashes, stored output sizes, 1600px
geometry and recipe identity before atomically registering exports and photo choices.
The service worker must independently decode, download and hash output before calling
finish; SQL storage metadata is not itself proof of JPEG content. Seller fields and
approval status are never changed by rendering. Changed snapshots terminate the job.

`test_render_queue.sql` exercises request idempotency, stale editor/worker rejection,
exclusive leases, incomplete receipts, in-flight photo changes, successful transactional
registration, protected historical exports and grants. It uses synthetic inventory and
an existing storage object as a receipt fixture, then rolls everything back. It is not
a real render acceptance test. No live render jobs were queued by this checkpoint.
Automatic intake enqueue, UI wiring and real-product acceptance remain
unfinished. To pause requests without deleting evidence or job history, run
`pause_render_queue.sql`; do not drop or truncate shared jobs.

## Machine transport checkpoint

`api/process_render.py` accepts only authenticated worker requests using a server-only
`STUDIO_RENDER_SECRET` of at least 64 characters. It downloads a bounded, signed URL
from this project's private originals bucket, rejects redirects, verifies source size
and SHA-256, and returns a decoded/verified 1600px JPEG. It holds no database credentials
and performs no storage writes, approval or publication. Uniform sources bypass
degenerate foreground clustering and retain the conservative natural fallback.

Transport tests cover authentication before network access, URL restrictions, source
integrity and actual JPEG output. Twelve renderer/endpoint tests pass, including six
same-runtime byte comparisons against the captured office recipe.

`../render-worker/` connects a leased job to the machine renderer using service-only
context from Vault. It signs each private source, preserves selection order and recipe
options, uploads content-addressed output without replacing existing objects, then
downloads and hashes the stored JPEG before registration. The Python transport verifies
full JPEG decoding and geometry; the Edge worker verifies stored byte identity. Its
110-second processing budget leaves time for recording failure and retry state. At most
four photo transports run concurrently; receipts retain source order even when requests
finish in a different order. Five orchestration tests cover ordering, ten-source bounded
concurrency, retries, malformed output and storage corruption.

Live cloud acceptance of this component processed batches of two, four and ten verified
inventory originals on separate test records. All jobs succeeded on their first attempt, stored
and re-downloaded every JPEG, and preserved seller fields and historical export sets.
Test records are archived and excluded from the active Studio list. The cron dispatcher
runs only when eligible render jobs exist. Owner-facing render controls remain unfinished;
no full workflow acceptance is claimed. The ten-photo test used the
largest currently selected verified originals, mixed natural/blur/brand styles and Pop,
and was picked up by the cloud cron dispatcher. All ten stored receipts matched the
requested source order. This validates that batch, not an unlimited throughput claim.

Automatic preparation now applies to new cloud-intake products with one to ten verified
inventory originals, each no larger than 16,000,000 bytes. Photo-selection insertion queues
the current immutable snapshot. Seller revision updates supersede waiting jobs and queue
the saved revision; running workers still reject changed snapshots at registration.
Approved products and historical exports are excluded. Eleven/twelve-photo uploads are
preserved but not automatically rendered by this bounded worker. The transaction test
checks enqueue, revision replacement, idempotency, approval isolation and private grants.
Owner upload-entry-point acceptance of this integration remains pending.

The pause script disables both automatic triggers and the render cron job. Resume requires
enabling `studio_intake_render` on `studio_core.photo_selection` and
`studio_intake_render_revision` on `studio_core.listing_authoring`, restoring the request
grant, and reapplying the render schedule. No saved inventory or jobs are deleted.

Manual retries use `studio_retry_render` with both current revisions and the failed job ID.
A retry creates a new job identity and keeps the failed job's attempt count and error intact;
duplicate clicks return the same child job. Late attempts from the original job cannot
register output for the retry. Existing exports, approved/archived products and changed
snapshots are rejected. Studio requires saving pending edits before retrying and resumes
progress polling without reopening or resetting the editor. Pausing render requests must
also revoke the retry grant, as the pause script now does.
