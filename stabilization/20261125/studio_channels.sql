begin;

create table studio_core.facebook_import_runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  account_tag text not null check (account_tag ~ '^[a-zA-Z0-9_-]{1,64}$'),
  mode text not null check (mode in ('full', 'new_only', 'availability_refresh')),
  state text not null default 'discovering'
    check (state in ('discovering', 'saving', 'completed', 'stopped', 'failed', 'interrupted')),
  started_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  saving_at timestamptz,
  finished_at timestamptz,
  found integer not null default 0 check (found between 0 and 100000),
  processed integer not null default 0,
  refreshed integer not null default 0,
  pending integer not null default 0,
  skipped integer not null default 0,
  error_code text,
  check (refreshed + pending + skipped = processed and processed <= found)
);
create unique index facebook_import_one_running
  on studio_core.facebook_import_runs (owner_id, account_tag)
  where state in ('discovering', 'saving');
create index facebook_import_recent on studio_core.facebook_import_runs (owner_id, started_at desc);

create table studio_core.facebook_import_batches (
  run_id uuid not null references studio_core.facebook_import_runs(id) on delete cascade,
  batch_no integer not null,
  rows_digest text not null,
  primary key (run_id, batch_no)
);

alter table studio_core.facebook_import_runs enable row level security;
alter table studio_core.facebook_import_batches enable row level security;
revoke all on studio_core.facebook_import_runs, studio_core.facebook_import_batches
  from public, anon, authenticated, service_role;

create function public.studio_facebook_import_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not studio_core.is_member() then
    raise exception 'Studio access denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(
    to_jsonb(r) - 'owner_id' ||
    case when r.state in ('discovering','saving') and r.updated_at < now() - interval '2 minutes'
      then jsonb_build_object('state','interrupted','finished_at',r.updated_at)
      else '{}'::jsonb end
    order by r.started_at desc), '[]'::jsonb) into result
  from (
    select * from studio_core.facebook_import_runs
    where owner_id=auth.uid()
    order by (state in ('discovering','saving') and updated_at >= now() - interval '2 minutes') desc, started_at desc
    limit 12
  ) r;
  return result;
end $$;

create function public.studio_facebook_import(
  p_action text, p_id uuid, p_account text default null, p_mode text default null,
  p_found integer default null, p_batch integer default null, p_rows jsonb default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  run studio_core.facebook_import_runs;
  prior_digest text;
  batch_digest text;
  result jsonb;
  row_count integer;
  refreshed_count integer;
  pending_count integer;
begin
  if actor is null or not studio_core.is_member() then
    raise exception 'Studio access denied' using errcode='42501';
  end if;
  if p_id is null or p_action is null or p_action not in ('start','heartbeat','saving','batch','complete','stop','fail') then
    raise exception 'Invalid import action';
  end if;

  if p_action='start' then
    if p_account is null or p_account !~ '^[a-zA-Z0-9_-]{1,64}$'
      or p_mode is null or p_mode not in ('full','new_only','availability_refresh') then
      raise exception 'Invalid import account or mode';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_account, 0));
    update studio_core.facebook_import_runs
      set state='interrupted', finished_at=updated_at
      where owner_id=actor and account_tag=p_account and state in ('discovering','saving')
        and updated_at < clock_timestamp()-interval '2 minutes';
    insert into studio_core.facebook_import_runs (id, owner_id, account_tag, mode)
      values (p_id, actor, p_account, p_mode) on conflict (id) do nothing;
  end if;

  select * into run from studio_core.facebook_import_runs where id=p_id and owner_id=actor for update;
  if not found then raise exception 'Import run not found' using errcode='42501'; end if;
  if p_action='start' and (run.account_tag, run.mode) is distinct from (p_account, p_mode) then
    raise exception 'Import run does not match this account or mode';
  end if;
  if run.state not in ('discovering','saving') then
    return to_jsonb(run) - 'owner_id';
  end if;

  if p_action='heartbeat' then
    if p_found is not null and p_found not between 0 and 100000 then raise exception 'Invalid listing count'; end if;
    update studio_core.facebook_import_runs set
      found=case when state='discovering' then greatest(facebook_import_runs.found,p_found) else facebook_import_runs.found end,
      updated_at=clock_timestamp() where id=p_id returning * into run;
  elsif p_action='saving' then
    if p_found is null or p_found not between 0 and 100000 or (run.state='saving' and p_found<>run.found) then
      raise exception 'Invalid listing count';
    end if;
    update studio_core.facebook_import_runs set state='saving', found=p_found, saving_at=coalesce(saving_at,clock_timestamp()), updated_at=clock_timestamp()
      where id=p_id returning * into run;
  elsif p_action='batch' then
    if run.state<>'saving' or p_batch is null or p_batch not between 0 and 100000
      or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid import batch'; end if;
    row_count := jsonb_array_length(p_rows);
    if row_count not between 1 and 50 or octet_length(p_rows::text)>1000000 then
      raise exception 'Invalid import batch size';
    end if;
    batch_digest := md5(p_rows::text);
    select rows_digest into prior_digest from studio_core.facebook_import_batches where run_id=p_id and batch_no=p_batch;
    if found then
      if prior_digest<>batch_digest then raise exception 'Import batch already has a different payload'; end if;
      return to_jsonb(run) - 'owner_id';
    end if;
    if run.processed + row_count > run.found then raise exception 'Too many import observations'; end if;

    result := public.studio_sync_observations(run.account_tag,run.mode,p_rows);
    refreshed_count := case when run.mode='new_only' then 0 else (result->>'matched')::integer end;
    pending_count := (result->>'pending')::integer;
    insert into studio_core.facebook_import_batches values (p_id,p_batch,batch_digest);
    update studio_core.facebook_import_runs set
      processed=processed+row_count, refreshed=refreshed+refreshed_count,
      pending=pending+pending_count, skipped=skipped+row_count-refreshed_count-pending_count,
      updated_at=clock_timestamp()
      where id=p_id returning * into run;
  elsif p_action in ('complete','stop','fail') then
    if p_action='complete' and (run.state<>'saving' or run.processed<>run.found) then
      raise exception 'Import still has unsaved observations';
    end if;
    update studio_core.facebook_import_runs set
      state=case p_action when 'complete' then 'completed' when 'stop' then 'stopped' else 'failed' end,
      error_code=case when p_action='fail' then 'SCANNER_ERROR' end,
      updated_at=clock_timestamp(), finished_at=clock_timestamp()
      where id=p_id returning * into run;
  end if;
  return to_jsonb(run) - 'owner_id';
end $$;

create function public.studio_channel_inventory(
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

  with links as materialized (
    select l.* from studio_core.physical_links l where l.owner_id=auth.uid() and l.status in ('confirmed','candidate')
      and exists (select 1 from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
        where i.id=l.studio_id and i.lifecycle='current' and a.status<>'archived')
  ), sources as materialized (
    select a.id, a.account_tag, a.facebook_id, a.title, a.price, a.last_seen_at, a.status,
      (a.is_active is true and a.status is not distinct from 'active' and coalesce(a.quantity,1)>0) as active,
      regexp_replace(lower(btrim(coalesce(a.title,''))), '[[:space:]]+', ' ', 'g') as title_key,
      case when l.studio_id is null then 'imported:'||a.id else 'studio:'||l.studio_id end as item_key
    from public.active_listings a
    left join links l on l.imported_id=a.id and l.status='confirmed'
  ), items as materialized (
    select 'studio:'||i.id as item_key, 'studio' as source_kind, i.id as source_id,
      coalesce(nullif(a.fields->>'title',''),i.id) as title, a.fields->>'price' as price, true as active
    from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
    where i.lifecycle='current' and a.status<>'archived'
    union all
    select s.item_key,'imported',s.id::text,s.title,s.price::text,s.active from sources s
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
      coalesce('studio:'||l.studio_id,q.source_kind||':'||q.source_id) as item_key,
      q.id, q.state, q.draft->>'price' as price, q.listing_url
    from studio_core.mercari_queue q
    left join links l on l.status='confirmed' and
      (q.physical_link_id=l.id or (q.source_kind='imported' and q.source_id=l.imported_id::text))
    where q.owner_id=auth.uid()
    order by item_key, (q.state in ('posted','ready','handed_off','needs_details')) desc, q.updated_at desc, q.id
  ), selected as (
    select distinct coalesce('studio:'||l.studio_id,c.source_kind||':'||c.source_id) as item_key
    from studio_core.mercari_catalog_choices c
    left join links l on c.source_kind='imported' and c.source_id=l.imported_id::text and l.status='confirmed'
    where c.owner_id=auth.uid() and c.included
  ), similar_titles as (
    select title_key from sources where active and length(title_key)>=8
    group by title_key having count(*)>1
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

revoke all on function public.studio_facebook_import_status() from public,anon,authenticated,service_role;
revoke all on function public.studio_facebook_import(text,uuid,text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.studio_channel_inventory(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.studio_facebook_import_status() to authenticated;
grant execute on function public.studio_facebook_import(text,uuid,text,text,integer,integer,jsonb) to authenticated;
grant execute on function public.studio_channel_inventory(text,text,integer,integer) to authenticated;

commit;
