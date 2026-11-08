# Manual notes only

Owner requirement, 2026-11-08: software must not generate inspection notes, inferred condition, cosmetic assessments, testing claims, accessory/completeness assumptions, or private listing notes. Only seller-entered notes are permitted.

The visual worker requests only product identity. Database triggers discard automatic note/condition fields, remove inspection text from generated copy, and remove narrative observations from research proposals. Seller edits use the existing authenticated, revision-checked RPC and retain their exact text. Automated writes preserve seller-authored titles, descriptions, notes, and condition.

The UI presents product facts and explicit seller input. It does not render generated inspection narratives. The office intake service uses the same copy policy and protects manual edits at its persistence boundary.

The owner-requested cleanup updated 25 cloud listings with revision checks and append-only edit history, cleaned 61 generated candidates, and removed current proposal/research notes. Two listings changed while the repair was prepared; their new manual descriptions were preserved. Already-listed statuses, prices, selected photos, and seller condition choices were retained. The office copy cleanup updated 20 stored listings and its 50-entry generated catalog, with a local database backup.

Validation: database integration assertions for manual text, machine writes, note suppression, stale revisions, and access control; matching Python/Postgres cleanup results for 60 original generated descriptions; browser tests at 390 and 1366 pixels for manual notes, absence of automatic narrative, bulk approval, and review progression; 11 existing JavaScript workflow/media tests; Python policy and SQLite persistence tests.

Regenerate `migrations/manual_notes_only.sql` with `python cloud-studio/copy_policy/build_migration.py`. The templates preserve the existing authentication and concurrency behavior. Run `test_manual_notes_only.sql` in a transaction; its writes roll back. Historical audit revisions remain available for recovery and are not listing content.
