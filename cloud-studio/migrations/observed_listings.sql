-- Observations can be incomplete. Keep collected fields separate from seller data.
create table studio_core.facebook_observations (
 account_tag text not null,
 facebook_id text not null,
 observed_at timestamptz not null,
 observed_by uuid not null references auth.users(id),
 evidence jsonb not null,
 primary key(account_tag, facebook_id)
);
alter table studio_core.facebook_observations enable row level security;
alter table studio_core.facebook_observations force row level security;
revoke all on studio_core.facebook_observations from public,anon,authenticated,service_role;

create function public.studio_sync_observations(p_account text, p_mode text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare observation jsonb; listing_id text; legacy_id bigint; matched integer:=0; pending integer:=0;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_account is null or p_account !~ '^[a-zA-Z0-9_-]{1,64}$' or p_mode is null or p_mode not in ('full','new_only','availability_refresh')
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50
 or octet_length(p_rows::text)>1000000 then raise exception 'Invalid observation batch'; end if;
 for observation in select value from jsonb_array_elements(p_rows) order by value->>'facebook_id' loop
  listing_id:=observation->>'facebook_id';
  if listing_id is null or listing_id !~ '^[0-9]{10,19}$' or observation->>'account_tag' is distinct from p_account
  then raise exception 'Invalid listing or account'; end if;
  select id into legacy_id from public.active_listings where account_tag=p_account and facebook_id=listing_id;
  if legacy_id is not null then
   matched:=matched+1;
   if p_mode='new_only' then continue; end if;
  else
   if p_mode='availability_refresh' then continue; end if;
   pending:=pending+1;
  end if;
  insert into studio_core.facebook_observations values(p_account,listing_id,statement_timestamp(),auth.uid(),observation)
  on conflict(account_tag,facebook_id) do update set observed_at=excluded.observed_at,observed_by=excluded.observed_by,evidence=excluded.evidence
  where facebook_observations.observed_at<=excluded.observed_at;
  if legacy_id is not null then
   update public.active_listings set last_seen_at=statement_timestamp()
   where id=legacy_id and (last_seen_at is null or last_seen_at<statement_timestamp());
  end if;
 end loop;
 return jsonb_build_object('matched',matched,'pending',pending);
end $$;
revoke all on function public.studio_sync_observations(text,text,jsonb) from public,anon,service_role;
grant execute on function public.studio_sync_observations(text,text,jsonb) to authenticated;
