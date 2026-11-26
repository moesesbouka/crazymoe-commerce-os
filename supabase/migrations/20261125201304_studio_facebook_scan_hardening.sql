begin;

-- Provision scanner accounts from an authenticated Studio owner, independently of
-- the posting-account editor, which only allows unused tags.
create table studio_core.facebook_scan_accounts (
  account_tag text primary key check (account_tag ~ '^[a-z0-9_-]{1,64}$'),
  owner_id uuid not null references auth.users(id),
  profile_id text not null unique check (profile_id ~ '^[1-9][0-9]{4,24}$')
);
alter table studio_core.facebook_scan_accounts enable row level security;
revoke all on studio_core.facebook_scan_accounts from public, anon, authenticated, service_role;

create function public.studio_register_facebook_scan_account(p_account text, p_profile text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists(select 1 from studio_core.members m
    where m.user_id=actor and m.enabled and m.role='owner') then
    raise exception 'Studio owner access required' using errcode='42501';
  end if;
  if p_account is null or p_account !~ '^[a-z0-9_-]{1,64}$'
    or p_profile is null or p_profile !~ '^[1-9][0-9]{4,24}$' then raise exception 'Invalid Facebook account binding'; end if;
  if exists(select 1 from studio_core.posting_accounts a
    where lower(a.account_tag)=p_account and (a.owner_id<>actor or a.profile_id<>p_profile)) then
    raise exception 'Facebook posting account disagrees with scanner binding';
  end if;
  insert into studio_core.facebook_scan_accounts values(p_account,actor,p_profile) on conflict (account_tag) do nothing;
  if not exists(select 1 from studio_core.facebook_scan_accounts a
    where a.account_tag=p_account and a.owner_id=actor and a.profile_id=p_profile) then
    raise exception 'Facebook account tag is already bound';
  end if;
end $$;

alter table studio_core.facebook_import_runs
  add column profile_id text,
  add column scanner_version text,
  add column pages integer not null default 0 check (pages between 0 and 300),
  add column end_reason text check (end_reason in ('end_of_feed','verified_empty','page_cap','failed')),
  add column progress_at timestamptz not null default clock_timestamp();
alter table studio_core.facebook_import_runs drop constraint facebook_import_runs_state_check,
  add constraint facebook_import_runs_state_check check (state in ('discovering','saving','completed','partial','stopped','failed','interrupted'));
-- Old active runs have no verified profile or discovery outcome.
update studio_core.facebook_import_runs set state='interrupted', finished_at=updated_at
  where state in ('discovering','saving');
drop index studio_core.facebook_import_one_running;
create unique index facebook_import_one_running
  on studio_core.facebook_import_runs(account_tag) where state in ('discovering','saving');

create table studio_core.facebook_import_seen (
  run_id uuid not null references studio_core.facebook_import_runs(id) on delete cascade,
  facebook_id text not null,
  primary key(run_id,facebook_id)
);
alter table studio_core.facebook_import_seen enable row level security;
revoke all on studio_core.facebook_import_seen from public, anon, authenticated, service_role;

create or replace function public.studio_facebook_import_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(
    to_jsonb(r) - 'owner_id' - 'profile_id' ||
    case
      when r.state in ('discovering','saving') and least(r.updated_at,r.progress_at) <= now()-interval '2 minutes'
        then jsonb_build_object('state','interrupted','finished_at',least(r.updated_at,r.progress_at))
      when r.state='completed' and r.end_reason is null
        then jsonb_build_object('state','partial')
      else '{}'::jsonb end order by r.started_at desc), '[]'::jsonb) into result
  from (
    select * from studio_core.facebook_import_runs where owner_id=auth.uid()
    order by (state in ('discovering','saving') and least(updated_at,progress_at)>now()-interval '2 minutes') desc,started_at desc
    limit 12
  ) r;
  return result;
end $$;

create function public.studio_facebook_import_v2(
  p_action text, p_id uuid, p_account text default null, p_mode text default null,
  p_found integer default null, p_batch integer default null, p_rows jsonb default null,
  p_profile text default null, p_version text default null, p_pages integer default null,
  p_end_reason text default null, p_error text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  run studio_core.facebook_import_runs;
  bound_account text;
  prior_digest text;
  batch_digest text;
  unique_rows jsonb;
  row_count integer;
  pending_count integer;
  refreshed_count integer;
  sync_result jsonb;
  stamp timestamptz;
begin
  if actor is null or not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
  if p_id is null or p_action is null or p_action not in ('start','heartbeat','saving','batch','complete','stop','fail') then
    raise exception 'Invalid import action';
  end if;

  if p_action='start' then
    if (p_account is not null and p_account !~ '^[a-z0-9_-]{1,64}$') or p_mode is null
      or p_mode not in ('full','new_only','availability_refresh') then raise exception 'Invalid import account or mode'; end if;
    if p_version is distinct from '66.0.13' then raise exception 'SCANNER_UPDATE_REQUIRED'; end if;
    select a.account_tag into bound_account from studio_core.facebook_scan_accounts a
      where a.owner_id=actor and a.profile_id=p_profile and (p_account is null or a.account_tag=p_account);
    if bound_account is null then raise exception 'FACEBOOK_ACCOUNT_MISMATCH' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended('facebook-scan:'||bound_account,0));
    update studio_core.facebook_import_runs set state='interrupted',finished_at=least(updated_at,progress_at)
      where account_tag=bound_account and state in ('discovering','saving')
        and least(updated_at,progress_at)<=clock_timestamp()-interval '2 minutes';
    insert into studio_core.facebook_import_runs(id,owner_id,account_tag,mode,profile_id,scanner_version)
      values(p_id,actor,bound_account,p_mode,p_profile,p_version) on conflict (id) do nothing;
  end if;

  select * into run from studio_core.facebook_import_runs where id=p_id and owner_id=actor for update;
  if not found then raise exception 'Import run not found' using errcode='42501'; end if;
  if p_action='start' and (run.account_tag,run.mode,run.profile_id,run.scanner_version)
    is distinct from (bound_account,p_mode,p_profile,p_version) then raise exception 'Import run identity changed'; end if;
  if run.state not in ('discovering','saving') then return to_jsonb(run)-'owner_id'-'profile_id'; end if;

  stamp:=clock_timestamp();
  if least(run.updated_at,run.progress_at)<=stamp-interval '2 minutes' then
    update studio_core.facebook_import_runs set state='interrupted',finished_at=least(updated_at,progress_at)
      where id=p_id returning * into run;
    return to_jsonb(run)-'owner_id'-'profile_id';
  end if;
  if p_action<>'stop' and not exists(select 1 from studio_core.facebook_scan_accounts a
    where a.account_tag=run.account_tag and a.owner_id=actor and a.profile_id=run.profile_id and a.profile_id=p_profile) then
    raise exception 'FACEBOOK_ACCOUNT_MISMATCH' using errcode='42501';
  end if;

  if p_action='heartbeat' then
    if (p_found is not null and p_found not between 0 and 100000)
      or (p_pages is not null and p_pages not between 0 and 300) then raise exception 'Invalid discovery progress'; end if;
    update studio_core.facebook_import_runs set
      progress_at=case when state='discovering' and (p_pages>run.pages or p_found>run.found) then stamp else progress_at end,
      pages=case when state='discovering' then greatest(run.pages,p_pages) else run.pages end,
      found=case when state='discovering' then greatest(run.found,p_found) else run.found end,
      updated_at=stamp where id=p_id returning * into run;
  elsif p_action='saving' then
    if p_found is null or p_found not between run.found and 100000 or p_pages is null or p_pages not between greatest(1,run.pages) and 300
      or p_end_reason is null or p_end_reason not in ('end_of_feed','verified_empty','page_cap')
      or (p_found=0 and p_end_reason<>'verified_empty')
      or (p_found>0 and p_end_reason='verified_empty')
      or (p_end_reason='page_cap' and p_pages<>300)
      or (run.state='saving' and (p_found,p_pages,p_end_reason) is distinct from (run.found,run.pages,run.end_reason)) then
      raise exception 'Invalid catalog coverage';
    end if;
    if run.state='discovering' then
      update studio_core.facebook_import_runs set state='saving',found=p_found,pages=p_pages,end_reason=p_end_reason,
        saving_at=stamp,updated_at=stamp,progress_at=stamp where id=p_id returning * into run;
    end if;
  elsif p_action='batch' then
    if run.state<>'saving' or p_batch is null or p_batch not between 0 and 100000 or jsonb_typeof(p_rows) is distinct from 'array'
      then raise exception 'Invalid import batch'; end if;
    if jsonb_array_length(p_rows) not between 1 and 50 or octet_length(p_rows::text)>1000000
      or exists(select 1 from jsonb_array_elements(p_rows) v
        where (v->>'facebook_id' ~ '^[0-9]{10,19}$') is not true or v->>'account_tag' is distinct from run.account_tag)
      then raise exception 'Invalid import observation'; end if;

    batch_digest:=md5(p_rows::text);
    select rows_digest into prior_digest from studio_core.facebook_import_batches where run_id=p_id and batch_no=p_batch;
    if found then
      if prior_digest<>batch_digest then raise exception 'Import batch already has a different payload'; end if;
      return to_jsonb(run)-'owner_id'-'profile_id';
    end if;

    with candidates as (
      select distinct on (v->>'facebook_id') v from jsonb_array_elements(p_rows) with ordinality rows(v,n)
      order by v->>'facebook_id',n
    ), seen as (
      insert into studio_core.facebook_import_seen(run_id,facebook_id)
        select p_id,v->>'facebook_id' from candidates on conflict do nothing returning facebook_id
    )
    select coalesce(jsonb_agg(v order by seen.facebook_id),'[]'::jsonb),
      count(*) filter (where run.mode<>'availability_refresh' and a.facebook_id is null and o.facebook_id is null)
    into unique_rows,pending_count
    from candidates c join seen on seen.facebook_id=c.v->>'facebook_id'
    left join lateral (select a.facebook_id from public.active_listings a
      where a.account_tag=run.account_tag and a.facebook_id=seen.facebook_id limit 1) a on true
    left join studio_core.facebook_observations o on o.account_tag=run.account_tag and o.facebook_id=seen.facebook_id;

    row_count:=jsonb_array_length(unique_rows);
    if run.processed+row_count>run.found then raise exception 'Too many import observations'; end if;
    refreshed_count:=0;
    if row_count>0 then
      sync_result:=public.studio_sync_observations(run.account_tag,run.mode,unique_rows);
      if run.mode<>'new_only' then refreshed_count:=(sync_result->>'matched')::integer; end if;
    end if;
    insert into studio_core.facebook_import_batches values(p_id,p_batch,batch_digest);
    update studio_core.facebook_import_runs set
      processed=processed+row_count,refreshed=refreshed+refreshed_count,pending=pending+pending_count,
      skipped=skipped+row_count-refreshed_count-pending_count,updated_at=stamp,
      progress_at=case when row_count>0 then stamp else progress_at end
      where id=p_id returning * into run;
  elsif p_action in ('complete','stop','fail') then
    if p_action='complete' and (run.state<>'saving' or run.processed<>run.found or run.end_reason is null) then
      raise exception 'Import still has unsaved observations or unverified coverage';
    end if;
    if p_action='fail' and (p_error is null or p_error not in
      ('FACEBOOK_HTTP','FACEBOOK_NETWORK','FACEBOOK_TIMEOUT','FACEBOOK_RESPONSE','FACEBOOK_CURSOR','FACEBOOK_IDENTITY','STUDIO_ERROR')) then
      raise exception 'Invalid scanner failure code';
    end if;
    update studio_core.facebook_import_runs set
      state=case when p_action='stop' then 'stopped' when p_action='fail' then 'failed'
        when run.end_reason='page_cap' then 'partial' else 'completed' end,
      end_reason=case when p_action='fail' and run.end_reason is null then 'failed' else run.end_reason end,
      error_code=case when p_action='fail' then p_error end,updated_at=stamp,finished_at=stamp
      where id=p_id returning * into run;
  end if;
  return to_jsonb(run)-'owner_id'-'profile_id';
end $$;

-- Maintain Stop for already-open Studio pages. Older scanners cannot start or write.
create or replace function public.studio_facebook_import(
  p_action text,p_id uuid,p_account text default null,p_mode text default null,
  p_found integer default null,p_batch integer default null,p_rows jsonb default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action is distinct from 'stop' then raise exception 'SCANNER_UPDATE_REQUIRED' using errcode='42501'; end if;
  return public.studio_facebook_import_v2('stop',p_id);
end $$;

revoke all on function public.studio_sync_observations(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_register_facebook_scan_account(text,text) from public,anon,authenticated,service_role;
revoke all on function public.studio_facebook_import_v2(text,uuid,text,text,integer,integer,jsonb,text,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_register_facebook_scan_account(text,text) to authenticated;
grant execute on function public.studio_facebook_import_v2(text,uuid,text,text,integer,integer,jsonb,text,text,integer,text,text) to authenticated;

-- Keep manually reviewed links unique per Studio item and Facebook account.
alter table studio_core.physical_links add column account_tag text;
update studio_core.physical_links l set account_tag=coalesce(lower(a.account_tag),'')
  from public.active_listings a where a.id=l.imported_id;
alter table studio_core.physical_links alter column account_tag set not null;

create function studio_core.set_physical_link_account() returns trigger
language plpgsql set search_path='' as $$
begin
  select coalesce(lower(a.account_tag),'') into strict new.account_tag
    from public.active_listings a where a.id=new.imported_id for share;
  return new;
end $$;
create trigger set_physical_link_account before insert or update of imported_id,account_tag on studio_core.physical_links
  for each row execute function studio_core.set_physical_link_account();

create function studio_core.refresh_physical_link_account() returns trigger
language plpgsql set search_path='' as $$
begin
  update studio_core.physical_links set account_tag=coalesce(lower(new.account_tag),'') where imported_id=new.id;
  return new;
end $$;
create trigger refresh_physical_link_account after update of account_tag on public.active_listings
  for each row when (old.account_tag is distinct from new.account_tag)
  execute function studio_core.refresh_physical_link_account();

create unique index physical_links_confirmed_studio_account
  on studio_core.physical_links(owner_id,studio_id,account_tag) where status='confirmed';
drop index studio_core.physical_links_confirmed_studio;

create or replace function public.studio_channel_inventory(
  p_view text default 'all', p_query text default '', p_offset integer default 0, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not studio_core.is_member() then
    raise exception 'Studio access denied' using errcode='42501';
  end if;
  if p_view is null or p_view not in ('all','fix','duplicates','stale','mercari','history')
    or p_query is null or length(p_query)>200 or p_offset is null or p_offset<0
    or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid inventory view'; end if;

  with recursive links as materialized (
    select l.* from studio_core.physical_links l where l.owner_id=auth.uid() and l.status in ('confirmed','candidate')
      and exists (select 1 from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
        where i.id=l.studio_id and i.lifecycle='current' and a.status<>'archived')
  ), exact_copies as materialized (
    select a.account_tag,c.listing_id,min(c.source_id) as source_id
    from studio_core.posting_copies c
    join studio_core.posting_accounts a on a.id=c.account_id and a.owner_id=c.owner_id
    where c.owner_id=auth.uid() and c.state='live' and c.listing_id ~ '^[0-9]{10,19}$'
    group by a.account_tag,c.listing_id
    having count(distinct c.source_id)=1
  ), copy_edges as materialized (
    select dest.id as dest_id, c.source_id
    from exact_copies c join public.active_listings dest
      on dest.account_tag=c.account_tag and dest.facebook_id=c.listing_id
    join public.active_listings original on original.id=c.source_id
    where dest.id<>c.source_id and dest.account_tag is distinct from original.account_tag
      and not exists (select 1 from links l where l.imported_id=dest.id and l.status='confirmed')
  ), copy_paths as (
    select dest_id, source_id, array[dest_id,source_id] as path from copy_edges
    union all
    select p.dest_id,e.source_id,p.path||e.source_id from copy_paths p join copy_edges e on e.dest_id=p.source_id
    where not e.source_id=any(p.path) and cardinality(p.path)<32
  ), copy_roots as (
    select p.dest_id,p.source_id from copy_paths p
    where not exists(select 1 from copy_edges e where e.dest_id=p.source_id)
  ), sources as materialized (
    select a.id, a.account_tag, a.facebook_id, a.title, a.price, a.last_seen_at, a.status,
      (a.is_active is true and a.status is not distinct from 'active' and coalesce(a.quantity,1)>0) as active,
      regexp_replace(lower(btrim(coalesce(a.title,''))), '[[:space:]]+', ' ', 'g') as title_key,
      case when l.studio_id is null then 'imported:'||coalesce(cr.source_id,a.id) else 'studio:'||l.studio_id end as item_key
    from public.active_listings a
    left join copy_roots cr on cr.dest_id=a.id
    left join links l on l.imported_id=coalesce(cr.source_id,a.id) and l.status='confirmed'
  ), items as materialized (
    select 'studio:'||i.id as item_key, 'studio' as source_kind, i.id as source_id,
      coalesce(nullif(a.fields->>'title',''),i.id) as title, a.fields->>'price' as price, true as active
    from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
    where i.lifecycle='current' and a.status<>'archived'
    union all
    select s.item_key,'imported',s.id::text,s.title,s.price::text,ax.active from sources s
    join (select item_key,bool_or(active) as active from sources group by item_key) ax using (item_key)
    where s.item_key='imported:'||s.id
  ), facebook as materialized (
    select s.item_key,s.account_tag,s.facebook_id,s.price::text as price,s.last_seen_at,
      case when s.status='sold' then 'sold' when not s.active then 'inactive'
        when s.last_seen_at>=now()-interval '7 days' then 'active' else 'stale' end as state
    from sources s
    union all
    select s.item_key,a.account_tag,c.listing_id,c.draft->>'price',null::timestamptz,'posted'
    from studio_core.posting_copies c
    join sources s on s.id=c.source_id
    join studio_core.posting_accounts a on a.id=c.account_id and a.owner_id=c.owner_id
    where c.owner_id=auth.uid() and c.state='live' and c.listing_id ~ '^[0-9]{10,19}$'
      and not exists (select 1 from sources imported where imported.account_tag=a.account_tag and imported.facebook_id=c.listing_id)
  ), facebook_by_item as (
    select f.item_key, jsonb_agg(to_jsonb(f)-'item_key' order by account_tag, facebook_id) as listings,
      bool_or(f.state='stale') as stale
    from facebook f group by f.item_key
  ), website as (
    select distinct on (s.item_key) s.item_key, w.price
    from public.public_listings w join sources s on s.account_tag=w.account_tag and s.facebook_id=w.facebook_id
    where w.is_active and w.is_published and w.visibility_scope='public' and w.status='active'
    order by s.item_key,w.updated_at desc nulls last
  ), mercari as (
    select distinct on (item_key)
      coalesce('studio:'||l.studio_id,source.item_key,q.source_kind||':'||q.source_id) as item_key,
      q.id, q.state, q.draft->>'price' as price, q.listing_url
    from studio_core.mercari_queue q
    left join links l on l.status='confirmed' and
      (q.physical_link_id=l.id or (q.source_kind='imported' and q.source_id=l.imported_id::text))
    left join sources source on q.source_kind='imported' and source.id::text=q.source_id
    where q.owner_id=auth.uid()
    order by item_key, (q.state in ('posted','ready','handed_off','needs_details')) desc, q.updated_at desc, q.id
  ), selected as (
    select distinct coalesce(source.item_key,c.source_kind||':'||c.source_id) as item_key
    from studio_core.mercari_catalog_choices c
    left join sources source on c.source_kind='imported' and c.source_id=source.id::text
    where c.owner_id=auth.uid() and c.included
  ), similar_titles as (
    select title_key from sources where active and length(title_key)>=8
    group by title_key having count(distinct item_key)>1
  ), duplicate_items as (
    select 'studio:'||l.studio_id as item_key from links l where l.status='candidate'
    union select s.item_key from sources s join similar_titles t using (title_key) where s.active
  ), enriched as (
    select i.*, coalesce(f.listings,'[]'::jsonb) as facebook,
      coalesce(f.stale,false) as stale, (d.item_key is not null) as possible_duplicate,
      (s.item_key is not null) as shortlisted,
      case when m.id is not null then to_jsonb(m)-'item_key' end as mercari,
      case when w.item_key is not null then jsonb_build_object('price',w.price) end as website,
      (m.state in ('needs_details','source_unavailable') or nullif(btrim(i.price),'') is null
        or nullif(btrim(i.title),'') is null) is true as needs_fixing
    from items i left join facebook_by_item f using (item_key)
    left join website w using (item_key) left join mercari m using (item_key)
    left join selected s using (item_key) left join duplicate_items d using (item_key)
  ), searched as materialized (
    select e.* from enriched e where p_query='' or position(lower(p_query) in lower(coalesce(e.title,'')||' '||e.source_id))>0
  ), filtered as materialized (
    select s.* from searched s
    where case p_view when 'all' then s.active or s.website is not null or s.mercari->>'state'='posted'
      when 'fix' then s.needs_fixing and s.active
      when 'duplicates' then s.possible_duplicate
      when 'stale' then s.stale
      when 'mercari' then s.shortlisted
      when 'history' then not s.active else false end
  ), page as (
    select * from filtered order by lower(title) nulls last,item_key offset p_offset limit p_limit
  ), accounts as (
    select account_tag, max(label) as label from (
      select f.account_tag, null::text as label from facebook f
      union all
      select a.account_tag,a.label from studio_core.posting_accounts a where a.owner_id=auth.uid()
      union all
      select a.account_tag,null::text from studio_core.facebook_scan_accounts a where a.owner_id=auth.uid()
    ) tags where nullif(account_tag,'') is not null group by account_tag
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.account_tag),'[]'::jsonb) from accounts a),
    'items',(select coalesce(jsonb_agg(to_jsonb(p)
      || jsonb_build_object(
        'review',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',s.title,'price',s.price,
          'facebook_id',s.facebook_id,'active',s.active) order by s.id),'[]'::jsonb)
          from links l join sources s on s.id=l.imported_id
          where l.status='candidate' and p.item_key='studio:'||l.studio_id),
        'related',(select coalesce(jsonb_agg(to_jsonb(r) order by r.active desc,r.id),'[]'::jsonb)
          from (select other.id,other.title,other.price,other.active,other.facebook_id,other.account_tag
            from sources source join sources other on other.title_key=source.title_key and other.item_key<>source.item_key
            where source.item_key=p.item_key and length(source.title_key)>=8
            order by other.active desc,other.id limit 12) r)
      ) order by lower(p.title) nulls last,p.item_key),'[]'::jsonb) from page p)
  ) into result;
  return result;
end $$;

create or replace function studio_core.mercari_prepare(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row jsonb;src jsonb;q studio_core.mercari_queue;result jsonb:='[]';readiness jsonb;link_id uuid; linked_studio text; created boolean;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception 'Select 1 to 50 products'; end if;
 for row in select value from jsonb_array_elements(p_rows) loop
  src:=studio_core.mercari_source(row->>'source_kind',row->>'source_id');
  if src is null or not coalesce((src->>'available')::boolean,false) then raise exception 'Product no longer available'; end if;
  if src->>'digest' is distinct from row->>'digest' then raise exception 'Inventory changed. Refresh before preparing.' using errcode='40001'; end if;
  perform studio_core.mercari_validate(row->'draft',src);
  readiness:=studio_core.mercari_readiness(row->'draft',src);
  link_id:=nullif(src#>>'{physical_link,id}','')::uuid;
  if coalesce(src#>>'{physical_link,status}','')<>'confirmed' then link_id:=null; end if;
  linked_studio:=case when link_id is not null then src#>>'{physical_link,studio_id}' end;
  if linked_studio is not null then
   perform pg_advisory_xact_lock(hashtextextended('mercari-studio:'||auth.uid()::text||':'||linked_studio,0));
  end if;
  q:=null;created:=false;
  select * into q from studio_core.mercari_queue
   where owner_id=auth.uid() and source_kind=row->>'source_kind' and source_id=row->>'source_id' limit 1;
  if q.id is null and link_id is not null then
   select * into q from studio_core.mercari_queue
    where owner_id=auth.uid() and state not in ('sold','cancelled','skipped')
      and ((source_kind='studio' and source_id=linked_studio) or exists(
        select 1 from studio_core.physical_links l
        where l.owner_id=auth.uid() and l.studio_id=linked_studio and l.status='confirmed'
        and (l.id=mercari_queue.physical_link_id or (source_kind='imported' and source_id=l.imported_id::text))))
    order by updated_at desc,id limit 1;
  end if;
  if q.id is null then
   insert into studio_core.mercari_queue(owner_id,source_kind,source_id,source_digest,source_snapshot,draft,state,physical_link_id,field_provenance)
   values(auth.uid(),row->>'source_kind',row->>'source_id',src->>'digest',src,row->'draft',
     case when (readiness->>'ready')::boolean then 'ready' else 'needs_details' end,link_id,
     jsonb_build_object('title','generated','description','generated','price','generated','condition',
       case when coalesce(src#>>'{fields,condition}','')='' then 'defaulted' else 'source_mapped' end,
       'category','generated','brand','generated','shipping','generated','photos','source'))
   on conflict(owner_id,source_kind,source_id) do update set source_snapshot=excluded.source_snapshot,source_digest=excluded.source_digest,
     physical_link_id=coalesce(mercari_queue.physical_link_id,excluded.physical_link_id),updated_at=now()
   returning * into q;
   created:=true;
  elsif q.source_kind=row->>'source_kind' and q.source_id=row->>'source_id' then
   update studio_core.mercari_queue set source_snapshot=src,source_digest=src->>'digest',
    physical_link_id=coalesce(physical_link_id,link_id),updated_at=now() where id=q.id returning * into q;
  end if;
  if created then insert into studio_core.mercari_events(queue_id,actor,event,revision,payload)
    values(q.id,auth.uid(),'prepared',q.revision,jsonb_build_object('policy_version',readiness->>'policy_version')); end if;
  result:=result||jsonb_build_object('id',q.id,'created',created);
 end loop;
 return result;
end $$;

commit;
