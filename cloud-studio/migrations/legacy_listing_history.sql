-- Additive recovery protection during migration of legacy sync clients.
-- No public.active_listings grants, policies, or seller fields are changed.
set local lock_timeout = '5s';
lock table public.active_listings in share row exclusive mode;

create table studio_core.legacy_listing_revisions (
 revision_id bigint generated always as identity primary key,
 listing_id bigint not null,
 operation text not null check(operation in ('BASELINE','INSERT','UPDATE','DELETE','TRUNCATE')),
 recorded_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current(),
 request_actor uuid,
 request_role text not null,
 before_row jsonb,
 after_row jsonb,
 check ((operation in ('BASELINE','INSERT') and before_row is null and after_row is not null)
     or (operation='UPDATE' and before_row is not null and after_row is not null)
     or (operation in ('DELETE','TRUNCATE') and before_row is not null and after_row is null))
);
create index legacy_listing_revisions_listing on studio_core.legacy_listing_revisions(listing_id,revision_id);
alter table studio_core.legacy_listing_revisions enable row level security;
alter table studio_core.legacy_listing_revisions force row level security;
revoke all on studio_core.legacy_listing_revisions from public,anon,authenticated,service_role;
revoke all on sequence studio_core.legacy_listing_revisions_revision_id_seq from public,anon,authenticated,service_role;

create function studio_core.capture_legacy_listing_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb; next_row jsonb;
begin
 if tg_table_schema<>'public' or tg_table_name<>'active_listings' then
  raise exception 'Unexpected history source';
 end if;
 if tg_op='TRUNCATE' then
  insert into studio_core.legacy_listing_revisions(listing_id,operation,request_actor,request_role,before_row)
  select id,'TRUNCATE',auth.uid(),current_setting('role'),to_jsonb(t) from public.active_listings t;
  return null;
 end if;
 if tg_op in ('UPDATE','DELETE') then prior:=to_jsonb(old); end if;
 if tg_op in ('INSERT','UPDATE') then next_row:=to_jsonb(new); end if;
 -- Routine sync heartbeats do not duplicate full records indefinitely.
 if tg_op='UPDATE' and (prior-array['updated_at','synced_at','last_seen_at'])
    is not distinct from (next_row-array['updated_at','synced_at','last_seen_at']) then return null; end if;
 insert into studio_core.legacy_listing_revisions(listing_id,operation,request_actor,request_role,before_row,after_row)
 values(coalesce(new.id,old.id),tg_op,auth.uid(),current_setting('role'),prior,next_row);
 return null;
end $$;
revoke all on function studio_core.capture_legacy_listing_revision() from public,anon,authenticated,service_role;
create trigger studio_legacy_listing_history after insert or update or delete on public.active_listings
 for each row execute function studio_core.capture_legacy_listing_revision();
create trigger studio_legacy_listing_truncate before truncate on public.active_listings
 for each statement execute function studio_core.capture_legacy_listing_revision();

insert into studio_core.legacy_listing_revisions(listing_id,operation,request_role,after_row)
select id,'BASELINE',current_setting('role'),to_jsonb(t) from public.active_listings t;

-- Existing daily snapshot enumeration includes this private studio_core table.
-- History is evidence only. Reverting a row requires comparing its current value
-- with the expected revision and preserving any newer seller changes.
