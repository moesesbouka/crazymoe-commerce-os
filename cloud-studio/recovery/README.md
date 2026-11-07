# Recovery verification

`index.ts` creates a private compressed core snapshot, downloads and hashes it,
rehearses its rows in temporary PostgreSQL tables, then records a receipt. The
daily database cron runs this independently of office computers.

The table rehearsal uses the live schema and external Auth foreign keys. It does
**not** establish recovery into a new Supabase project, recover Auth identities,
or back up photo bytes by itself.

## Matching core and media

`copy.ts` is the `studio-recovery-copy` operator endpoint. It accepts POST with
the existing Vault-validated worker credential and a snapshot path/SHA-256 from
`studio_migration.recovery_receipts`. It downloads and verifies that snapshot,
then signs only its exact referenced private media objects for 15 minutes.
The response contains temporary credentials and must stay private. Never put
the response, snapshots, receipts containing business data, or ZIPs in GitHub.
The endpoint performs no inventory or storage writes. Nightly recovery does not
automatically export a bundle or send its URLs elsewhere.

`download_bundle.py` consumes this private plan, optionally reuses a prior media
ZIP, verifies every copied/downloaded object, and writes a new directory only
after the independent verifier succeeds. It accepts only the configured private
Supabase storage host and exact object paths; redirects are rejected. It needs
no service key or owner session. Retain the snapshot receipt separately from
the bundle; delete the temporary plan when the transfer is finished.

```sh
python download_bundle.py PRIVATE_PLAN.json NEW_DIRECTORY --cache PREVIOUS_MEDIA.zip
python verify_bundle.py NEW_DIRECTORY/core.json.gz NEW_DIRECTORY/media.zip RECEIPT_SHA256
```

`verify_bundle.py` works without a network connection or database. It checks the
core receipt hash, format, table counts, column layouts, every media reference,
and every media byte. Missing files, same-size corruption, inconsistent sizes,
duplicate JSON/ZIP entries, and unsafe paths fail closed. Extra media from a
newer archive is allowed only if its bytes also verify and is separately counted.
Assets are required even if their old verification timestamp is null.

The existing `../photo_migration/recover_media.py` can restore the media ZIP to a
new empty directory using the manifest hash returned by the verifier. It checks
the restored bytes again. Neither tool overwrites an existing recovery target.

## Scope and rollback

Passing these checks proves matching snapshot/media integrity. A local bundle is
an additional recovery copy, not an independent cloud backup. Cross-project
schema, Auth, routine/sequence restoration, ongoing external backup delivery,
and full office-unavailable acceptance remain separate requirements.

To close operator export without disturbing daily backups, redeploy
`studio-recovery-copy` with `Deno.serve(() => new Response(null, {status: 410}));`.
Previously issued signed links expire after at most 15 minutes.

## Tests

```sh
python -m unittest discover -s cloud-studio/recovery -p 'test_*.py' -v
node --test cloud-studio/recovery/test_copy_manifest.mjs
```

Tests use synthetic bytes only. No test publishes listings or edits inventory.
