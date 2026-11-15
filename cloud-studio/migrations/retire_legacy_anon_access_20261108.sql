begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve the storefront catalog while retiring unrestricted writes.
alter policy "allow anon select" on public.active_listings to anon
using (
  is_active = true
  and lower(status) = 'active'
  and (is_published = true or visibility_scope = 'public')
);
alter policy "allow anon delete" on public.active_listings to authenticated
using ((select studio_core.is_member()));
alter policy "allow anon update" on public.active_listings to authenticated
using ((select studio_core.is_member()))
with check ((select studio_core.is_member()));
alter policy "allow anon upsert" on public.active_listings to authenticated
with check ((select studio_core.is_member()));

alter policy "allow anon select" on public.active_listings rename to public_catalog_active_listings_read;
alter policy "allow anon delete" on public.active_listings rename to legacy_member_delete;
alter policy "allow anon update" on public.active_listings rename to legacy_member_update;
alter policy "allow anon upsert" on public.active_listings rename to legacy_member_insert;

revoke all on table public.active_listings from anon;
revoke all on table public.active_listings from public;
grant select (
  id, facebook_id, account_tag, title, description, price, condition,
  category, listing_url, images, status, is_active, synced_at,
  is_published, visibility_scope, published_at
) on table public.active_listings to anon;
grant select, insert, update, delete on table public.active_listings to authenticated;

-- All views now honor the caller's RLS and column privileges.
alter view public.public_active_listings set (security_invoker = true);
alter view public.public_listings set (security_invoker = true);
alter view public.admin_listings set (security_invoker = true);
alter view public.private_inventory set (security_invoker = true);
alter view public.cmoe_dashboard_summary set (security_invoker = true);

revoke all on table public.public_active_listings from anon;
revoke all on table public.public_active_listings from public;
revoke all on table public.public_listings from anon;
revoke all on table public.public_listings from public;
grant select on table public.public_active_listings to anon, authenticated;
grant select on table public.public_listings to anon, authenticated;

revoke all on table public.admin_listings from anon;
revoke all on table public.admin_listings from public;
revoke all on table public.private_inventory from anon;
revoke all on table public.private_inventory from public;
revoke all on table public.cmoe_dashboard_summary from anon;
revoke all on table public.cmoe_dashboard_summary from public;
grant select on table public.admin_listings to authenticated;
grant select on table public.private_inventory to authenticated;
grant select on table public.cmoe_dashboard_summary to authenticated;

revoke all on function public.run_cmoe_detector(text) from public;
revoke all on function public.run_cmoe_detector(text) from anon;
grant execute on function public.run_cmoe_detector(text) to authenticated, service_role;

commit;
