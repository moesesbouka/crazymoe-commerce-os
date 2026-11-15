begin;

alter policy legacy_member_delete on public.active_listings
to service_role using (true);
alter policy legacy_member_update on public.active_listings
to service_role using (true) with check (true);
alter policy legacy_member_insert on public.active_listings
to service_role with check (true);

alter policy legacy_member_delete on public.active_listings
rename to legacy_service_role_delete;
alter policy legacy_member_update on public.active_listings
rename to legacy_service_role_update;
alter policy legacy_member_insert on public.active_listings
rename to legacy_service_role_insert;

commit;
