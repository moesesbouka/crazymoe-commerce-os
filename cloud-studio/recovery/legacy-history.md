# Legacy listing recovery during access migration

`legacy_listing_history.sql` captures an exact baseline of `public.active_listings`
under a short write lock and installs transactionally coupled change capture.
It preserves before/after JSON for inserts, business-field updates and deletes;
the before-truncate trigger retains each row before a truncate operation.
Routine changes limited to `updated_at`, `synced_at`, and `last_seen_at` are
excluded to avoid unbounded full-row copies for ordinary sync heartbeats.

The private `studio_core.legacy_listing_revisions` table has forced RLS and no
public, authenticated, or service-role table/sequence permissions. Its trigger
function is not executable by API roles. Request actor and role are diagnostic
context, not proof of seller approval or an authorization mechanism. History
contains private fields and must never be exported to the public repository.

The existing daily cloud backup automatically includes the history table and
rehearses its rows in temporary tables. This preserves the legacy baseline and
subsequent business changes even while older clients still use broad access.
It does not make that broad access secure or authorize revoking it before the
remaining clients and storefront have been migrated and tested.

Recovery must identify a specific revision and compare the current row against
the expected state before restoring seller fields. Do not bulk overwrite current
rows from the baseline: later seller changes must be preserved. Heartbeat clocks
are not a complete audit trail. Changes predating baseline capture are not added.

Validation uses rollback-only transactions. The synthetic insert/delete fixture
uses a negative ID and checks collisions; it does not advance the live listing
ID sequence. Revision sequence gaps after rollback are normal. Do not truncate
the production table merely to test the truncate hook.

If this capture must be paused, preserve all collected history and disable only
the two triggers in one transaction:

```sql
begin;
set local lock_timeout = '5s';
alter table public.active_listings disable trigger studio_legacy_listing_history;
alter table public.active_listings disable trigger studio_legacy_listing_truncate;
commit;
```

Re-enable both after resolving the problem; any changes while paused require a
separately identified new baseline. Never reset or delete existing revisions.
