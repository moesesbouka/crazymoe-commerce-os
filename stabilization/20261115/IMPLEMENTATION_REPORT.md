# Crazy Moe Marketplace stabilization implementation report

Date: 2026-11-15 UTC

## Production release

- Release: `stabilize-20261115.2`
- Deployed source: `bb86e23272630c1e8ba0f412b5cd36f2b43a3d5e`
- Vercel deployment: `dpl_EigcJnVfjqTqA2GH6K4TjWPCAMcL`
- Database behavior migration head: `20261115062349`
- Companion: `2.4.0`
- Companion ZIP SHA-256: `161d8d34507daffbc56c63b44d17d71842d87a13a635ec001f4b7e5395ec8a2c`
- Readiness policy: `mercari-2026-11-15.1`
- Edge worker: `studio-mercari-research-worker` version 1

The live aliases `studio.crazymoe.com` and `crazymoe-marketplace-studio.vercel.app` point to that deployment. The old Mercari project was renamed `retired-crazymoe-mercari-desk-20261115`; both of its former aliases now resolve to the current Studio.

## Implemented controls

1. Captured the exact production source, Supabase schema/migrations/functions, Edge Functions, Storage manifest, companion ZIP, and hashes on `stabilize-20261115`.
2. Added one server-owned readiness result with stable issue codes. Download, browser handoff, and posted transitions now call the same gate.
3. Preserved seller-set fields during source rebuilds and recorded field provenance.
4. Added fail-closed seven-day inventory eligibility plus explicit seven-day seller availability confirmation. Incomplete scans never mass-inactivate inventory.
5. Added non-destructive physical-item link candidates. Candidates never merge automatically; confirmed links collapse the actionable queue only after review.
6. Separated publication evidence from historical `listed` labels; 56 legacy records are preserved as `seller_asserted` evidence.
7. Removed the browser companion's duplicate business-rule preflight. Version 2.4.0 requires server approval, the exact contract, a complete DOM contract, and a revision-bound handoff.
8. Removed anonymous execution of the research SECURITY DEFINER RPC. The Lenovo worker now uses a bounded custom-token Edge Function; the token was rotated after cutover and the old token was removed.
9. Added correlation-ID telemetry without listing text, prices, photos, cookies, DOM dumps, or credentials.
10. Added `/health.html`, backed by an authenticated owner-checked RPC, for release, worker, inventory, queue, duplicate, and telemetry health.
11. Added deterministic contract tests and pinned GitHub Actions checkout.
12. Retained expand/contract compatibility and the prior production deployment ID for rollback.

## Verification performed

- Contract suite and syntax checks pass.
- Unknown source conditions block with `CONDITION_UNMAPPED` and the raw source condition.
- Incomplete download and posted transitions are rejected by the same database gate.
- A seller price override survived a simulated source rebuild (`777.00`, provenance `seller_set`) inside a rolled-back transaction.
- A stale imported item remained ineligible until explicit seller confirmation, then became `seller_confirmed` and eligible inside a rolled-back transaction.
- A duplicate candidate changed to confirmed only after the explicit review RPC inside a rolled-back transaction.
- Anonymous direct research-RPC execution returns 401 and `anon` has no execute grant.
- The Lenovo worker continued heartbeating through the Edge endpoint after token rotation.
- Production health, Mercari, companion, and render routes were checked. The render route correctly returns `405 POST required` on GET.
- The deployment rollback procedure was exercised when one Vercel redeploy nested the source incorrectly. Both aliases were restored to the previous known-good release, then moved to a fresh verified production build.
- Daily database recovery receipts are present and verified through 2026-11-14; the next scheduled run is 07:18 UTC.

## Current operational state

- Mercari queue: 13 `needs_details`, 2 `posted`, 0 `ready`.
- Duplicate candidates awaiting seller review: 9.
- Imported active records are stale because no recent scanner observation exists. They remain available under the stale view but are excluded from the default actionable shortlist until rescanned or explicitly confirmed.
- The unpacked companion source on `DESKTOP-NGK53N6` was updated to 2.4.0 with exact file-hash verification. `worker.js` was also updated as a transition shim for the currently cached 2.3.0 manifest. The office machine `DESKTOP-B3A97CU` was offline and could not be updated remotely.
- Draft PR for engineering review: https://github.com/moesesbouka/crazymoe-commerce-os/pull/4

## Intentionally unresolved or externally blocked

1. Supabase leaked-password protection remains disabled. It is a dashboard-only Auth setting in the available tooling, and the dashboard requires an interactive Supabase sign-in.
2. The existing Vercel project is not automatically linked to the Git repository. API deployments now carry exact Git metadata, and production is reproducible from the stabilization tree, but Vercel does not expose reconnecting this existing project through the available connector. Do not create another production project merely to obtain Git linkage.
3. The draft PR is intentionally not merged into `main`. `main` contains an obsolete Mercari implementation and the PR currently conflicts; forcing the merge would recreate source-of-truth drift.
4. The 44 RLS-without-policy findings are deny-by-default private/internal tables. Adding permissive policies would weaken the design. The authenticated SECURITY DEFINER findings are intentional owner/member-checked API functions with pinned empty `search_path`.
5. `pg_net` remains in `public`. Moving it without a dependency migration could break scheduled recovery and rendering jobs.
6. Advisor-recommended indexes outside the active Mercari relationships were not added blindly. Add them only after workload evidence or when the corresponding feature is exercised.

## Next operator actions

1. Sign in to the Supabase dashboard and enable leaked-password protection.
2. Run a complete Facebook scanner pass, then review the stale inventory view.
3. Review the nine duplicate candidates; confirm only the same physical unit, otherwise reject.
4. On any computer still showing companion 2.3.0, reload the unpacked extension or install the ZIP from Studio. The Studio refuses an old companion by design.
5. Have the AI team review PR #4 and design a deliberate retirement of the obsolete `main` root files before merging.
