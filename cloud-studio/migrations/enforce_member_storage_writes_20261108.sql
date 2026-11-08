begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Legacy bucket policies remain readable for storefront images, but every
-- write to a legacy product-photo bucket must come from a Studio member or
-- an internal service-role operation.
create or replace function studio_core.enforce_member_storage_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_bucket text := case when tg_op in ('UPDATE','DELETE') then old.bucket_id else null end;
  new_bucket text := case when tg_op in ('INSERT','UPDATE') then new.bucket_id else null end;
  request_role text := auth.role();
  permitted boolean := false;
begin
  if coalesce(old_bucket,'') = any(array['bdd-images','listing-images','listing-photos'])
     or coalesce(new_bucket,'') = any(array['bdd-images','listing-images','listing-photos']) then
    if request_role = 'service_role' then
      permitted := true;
    elsif request_role = 'authenticated' then
      permitted := studio_core.is_member();
    elsif request_role is null and current_user in ('postgres','supabase_storage_admin') then
      permitted := true;
    end if;
    if not permitted then
      raise insufficient_privilege using message = 'Studio membership required for storage writes';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function studio_core.enforce_member_storage_writes() from public;
grant execute on function studio_core.enforce_member_storage_writes()
to anon, authenticated, service_role, supabase_storage_admin;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'storage.objects'::regclass
      and tgname = 'enforce_member_storage_writes'
      and not tgisinternal
  ) then
    create trigger enforce_member_storage_writes
    before insert or update or delete on storage.objects
    for each row execute function studio_core.enforce_member_storage_writes();
  end if;
end;
$$;

commit;
