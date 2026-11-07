-- Preserve each previous ACL and view definition in the private recovery schema.
create table studio_migration.legacy_access_before as
select c.oid::regclass::text as relation,c.relacl::text as acl,c.relrowsecurity as row_security,
 case when c.relkind='v' then pg_get_viewdef(c.oid,true) end as view_definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('marketplace_listings_backup','marketplace_drafts',
 'crosslist_events','category_rules','listing_evaluations','comp_queue','action_queue','admin_listings','private_inventory');
alter table studio_migration.legacy_access_before enable row level security;
alter table studio_migration.legacy_access_before force row level security;
revoke all on studio_migration.legacy_access_before from public,anon,authenticated,service_role;
do $$
declare obj text;
begin
 foreach obj in array array['marketplace_listings_backup','marketplace_drafts','crosslist_events','category_rules','listing_evaluations','comp_queue','action_queue'] loop
  execute format('alter table public.%I enable row level security',obj);
  execute format('revoke all on public.%I from public,anon',obj);
  execute format('create policy studio_member_access on public.%I for all to authenticated using ((select studio_core.is_member())) with check ((select studio_core.is_member()))',obj);
  execute format('revoke truncate, references, trigger on public.%I from authenticated',obj);
 end loop;
end $$;
revoke all on public.admin_listings,public.private_inventory from public,anon,authenticated;
