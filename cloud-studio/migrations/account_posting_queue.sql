-- Account-scoped copies of existing active listings. Source records stay intact.
create table studio_core.posting_accounts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 label text not null check(length(label) between 1 and 100),
 profile_id text not null check(profile_id ~ '^[0-9]{5,25}$'),
 account_tag text not null check(account_tag ~ '^[a-zA-Z0-9_-]{1,64}$'),
 created_at timestamptz not null default now(), unique(owner_id,profile_id), unique(owner_id,account_tag)
);
create table studio_core.posting_copies (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 source_id bigint not null references public.active_listings(id),
 account_id uuid not null references studio_core.posting_accounts(id),
 revision integer not null default 1, source_digest text not null, draft jsonb not null,
 state text not null default 'prepared' check(state in ('prepared','filling','filled','submitted','live','error','stale','cancelled','remove_needed')),
 listing_id text, issue text, transfer_hash text, transfer_expires timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,source_id,account_id), unique(account_id,listing_id)
);
create table studio_core.posting_events (
 id bigint generated always as identity primary key,
 copy_id uuid not null references studio_core.posting_copies(id),
 state text not null, happened_at timestamptz not null default now(), evidence jsonb not null default '{}'
);
alter table studio_core.posting_accounts enable row level security;
alter table studio_core.posting_accounts force row level security;
alter table studio_core.posting_copies enable row level security;
alter table studio_core.posting_copies force row level security;
alter table studio_core.posting_events enable row level security;
alter table studio_core.posting_events force row level security;
revoke all on studio_core.posting_accounts,studio_core.posting_copies,studio_core.posting_events from public,anon,authenticated,service_role;
create index posting_copy_owner on studio_core.posting_copies(owner_id,updated_at desc);
create index posting_copy_source on studio_core.posting_copies(source_id);
create index posting_event_copy on studio_core.posting_events(copy_id,happened_at);
create index posting_copy_token on studio_core.posting_copies(transfer_hash) where transfer_hash is not null;

create function studio_core.posting_digest(p public.active_listings) returns text
language sql immutable set search_path='' as $$
 select md5(jsonb_build_object('title',p.title,'description',p.description,'price',p.price,
 'condition',p.condition,'images',p.images,'status',p.status,'active',p.is_active,'quantity',p.quantity,'account',p.account_tag)::text)
$$;
revoke all on function studio_core.posting_digest(public.active_listings) from public,anon,authenticated,service_role;

create function public.studio_posting_accounts(p_label text default null,p_profile text default null,p_tag text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_label is not null then
  if length(trim(p_label)) not between 1 and 100 or p_profile is null or p_profile !~ '^[0-9]{5,25}$'
    or p_tag is null or p_tag !~ '^[a-zA-Z0-9_-]{1,64}$'
    or exists(select 1 from public.active_listings where account_tag=p_tag)
  then raise exception 'Use a new account tag, seller name, and numeric Facebook profile ID'; end if;
  insert into studio_core.posting_accounts(owner_id,label,profile_id,account_tag)
  values(auth.uid(),trim(p_label),p_profile,p_tag)
  on conflict(owner_id,profile_id) do update set label=excluded.label;
 end if;
 return coalesce((select jsonb_agg(to_jsonb(a)-'owner_id' order by created_at) from studio_core.posting_accounts a where owner_id=auth.uid()),'[]');
end $$;

create function public.studio_posting_inventory(p_query text default '',p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 if p_offset<0 or p_limit not between 1 and 200 or length(p_query)>200 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('total',(select count(*) from public.active_listings a where a.is_active is true and a.status='active'
  and coalesce(a.quantity,1)>0 and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)),
 'items',coalesce(jsonb_agg(to_jsonb(r)),'[]')) into result from (
  select a.id,a.facebook_id,a.account_tag,a.title,a.description,a.price,a.condition,a.category,a.images,a.quantity,a.listing_url,
   studio_core.posting_digest(a) as digest,a.last_seen_at,
   (select coalesce(jsonb_agg(jsonb_build_object('account_id',c.account_id,'state',c.state,'id',c.id)),'[]')
    from studio_core.posting_copies c where c.source_id=a.id and c.owner_id=auth.uid()) as copies
  from public.active_listings a where a.is_active is true and a.status='active' and coalesce(a.quantity,1)>0
  and (p_query='' or position(lower(p_query) in lower(coalesce(a.title,'')||' '||coalesce(a.category,'')))>0)
  order by a.id desc limit p_limit offset p_offset
 ) r;
 return result;
end $$;

create function public.studio_posting_prepare(p_account uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; src public.active_listings; dest studio_core.posting_accounts; prior studio_core.posting_copies;
 copy_id uuid; draft jsonb; photo text; results jsonb:='[]';
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into dest from studio_core.posting_accounts where id=p_account and owner_id=auth.uid();
 if dest.id is null then raise exception 'Choose your destination account'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 or octet_length(p_rows::text)>2000000
 then raise exception 'Choose between 1 and 50 products per batch'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by (value->>'source_id')::bigint loop
  select * into src from public.active_listings where id=(r->>'source_id')::bigint for share;
  if src.id is null or src.is_active is not true or src.status is distinct from 'active' or coalesce(src.quantity,1)<=0
  then raise exception 'A selected product is no longer available'; end if;
  if src.account_tag=dest.account_tag then raise exception 'Source and destination must differ'; end if;
  if studio_core.posting_digest(src) is distinct from r->>'digest' then raise exception 'Product changed; refresh before preparing' using errcode='40001'; end if;
  if nullif(trim(src.description),'') is null or nullif(trim(src.condition),'') is null or src.price is null or src.price<0
  then raise exception 'Source description, condition, or price is missing'; end if;
  draft:=r->'draft';
  if jsonb_typeof(draft) is distinct from 'object' or length(trim(coalesce(draft->>'title',''))) not between 1 and 150
   or length(trim(coalesce(draft->>'description',''))) not between 1 and 20000
   or jsonb_typeof(draft->'images') is distinct from 'array' or jsonb_array_length(draft->'images') not between 1 and 10
  then raise exception 'Check title, description, and one to ten photos'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(draft->'images'))<>jsonb_array_length(draft->'images') then raise exception 'Repeated photo'; end if;
  for photo in select value from jsonb_array_elements_text(draft->'images') loop
   if not (photo=any(coalesce(src.images,array[]::text[]))) or photo !~ '^https://sfheqjnxlkygjfohoybo\.supabase\.co/storage/v1/object/public/listing-images/'
   then raise exception 'Use an archived public photo from this product'; end if;
  end loop;
  draft:=jsonb_build_object('title',trim(draft->>'title'),'description',trim(draft->>'description'),
   'price',src.price,'condition',src.condition,'category',src.category,'images',draft->'images');
  select * into prior from studio_core.posting_copies where owner_id=auth.uid() and source_id=src.id and account_id=dest.id for update;
  if prior.id is not null and prior.state not in ('prepared','error','stale','cancelled') then
   raise exception 'This product already has a draft or listing on the destination';
  end if;
  insert into studio_core.posting_copies(owner_id,source_id,account_id,source_digest,draft)
  values(auth.uid(),src.id,dest.id,r->>'digest',draft)
  on conflict(owner_id,source_id,account_id) do update set draft=excluded.draft,source_digest=excluded.source_digest,
   state='prepared',revision=posting_copies.revision+1,issue=null,transfer_hash=null,transfer_expires=null,updated_at=now()
  where posting_copies.state in ('prepared','error','stale','cancelled')
  returning id into copy_id;
  if copy_id is null then raise exception 'Destination workflow changed; refresh before preparing' using errcode='40001'; end if;
  insert into studio_core.posting_events(copy_id,state) values(copy_id,'prepared');
  results:=results||jsonb_build_array(copy_id);
 end loop;
 return results;
end $$;

create function public.studio_posting_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 -- Reconciliation is also performed on every attempted handoff. A stale snapshot never authorizes a fill.
 update studio_core.posting_copies c set state=case when c.state in ('filled','submitted','live') then 'remove_needed' else 'cancelled' end,
  issue='Source is no longer available',transfer_hash=null,updated_at=now()
 from public.active_listings s where c.source_id=s.id and c.owner_id=auth.uid()
  and (s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0)
  and c.state not in ('cancelled','remove_needed');
 update studio_core.posting_copies c set state='stale',issue='Source details changed; prepare this product again',transfer_hash=null,updated_at=now()
 from public.active_listings s where c.source_id=s.id and c.owner_id=auth.uid() and c.state in ('prepared','filling','error')
  and studio_core.posting_digest(s)<>c.source_digest;
 update studio_core.posting_copies set state='error',issue='Transfer expired. Inspect the Facebook draft before retrying.',transfer_hash=null,updated_at=now()
 where owner_id=auth.uid() and state='filling' and transfer_expires<now();
 -- Only a separately observed destination listing can be called live.
 update studio_core.posting_copies c set state='live',issue=null,updated_at=now()
 from studio_core.posting_accounts a, studio_core.facebook_observations o
 where c.owner_id=auth.uid() and c.state='submitted' and c.account_id=a.id and o.account_tag=a.account_tag
  and o.facebook_id=c.listing_id and o.observed_at>c.updated_at
  and o.evidence->>'status'='active' and o.evidence->>'title'=c.draft->>'title';
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
  select c.id,c.source_id,c.account_id,c.revision,c.state,c.draft,c.listing_id,c.issue,c.created_at,c.updated_at,
   a.label as account_label,a.profile_id,a.account_tag,s.title as original_title,s.listing_url as source_url,
   s.status as source_status,s.is_active as source_active
  from studio_core.posting_copies c join studio_core.posting_accounts a on a.id=c.account_id
  join public.active_listings s on s.id=c.source_id where c.owner_id=auth.uid()
 ) r),'[]');
end $$;

create function public.studio_posting_claim(p_id uuid,p_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts; token text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into c from studio_core.posting_copies where id=p_id and owner_id=auth.uid() for update;
 if c.id is null or c.revision<>p_revision or c.state<>'prepared' then raise exception 'Refresh the queue; this product is not ready'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Source changed or sold; refresh the queue' using errcode='40001'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id and owner_id=auth.uid() for update;
 if exists(select 1 from studio_core.posting_copies where account_id=c.account_id and owner_id=auth.uid() and id<>c.id and state in ('filling','filled'))
 then raise exception 'Finish the current destination draft before starting another'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 update studio_core.posting_copies set state='filling',transfer_hash=encode(extensions.digest(token,'sha256'),'hex'),
  transfer_expires=now()+interval '15 minutes',updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state) values(c.id,'filling');
 return jsonb_build_object('token',token,'id',c.id,'profile_id',a.profile_id,'account_label',a.label);
end $$;

create function public.studio_posting_result(p_id uuid,p_revision integer,p_action text,p_url text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c studio_core.posting_copies; listing text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into c from studio_core.posting_copies where id=p_id and owner_id=auth.uid() for update;
 if c.id is null or c.revision<>p_revision then raise exception 'Refresh the queue' using errcode='40001'; end if;
 if p_action='submitted' then
  if c.state not in ('filled','submitted') then raise exception 'Fill and review the draft first'; end if;
  listing:=substring(p_url from '^https://(?:www\.|m\.)?facebook\.com/marketplace/item/([0-9]{10,25})/?(?:\?.*)?$');
  if listing is null or listing=(select facebook_id from public.active_listings where id=c.source_id)
  then raise exception 'Paste the new destination listing URL'; end if;
  update studio_core.posting_copies set state='submitted',listing_id=listing,issue='Publication recorded; awaiting destination observation',transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='retry' then
  if c.state<>'error' then raise exception 'Only a failed transfer can be retried'; end if;
  update studio_core.posting_copies set state='prepared',revision=revision+1,issue=null,transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='cancel' then
  if c.state in ('submitted','live','remove_needed') then raise exception 'Mark the Facebook listing sold or remove it first'; end if;
  update studio_core.posting_copies set state='cancelled',transfer_hash=null,updated_at=now() where id=c.id;
 elsif p_action='removed' then
  if c.state<>'remove_needed' then raise exception 'No removal is pending'; end if;
  update studio_core.posting_copies set state='cancelled',issue='Seller confirmed destination removal',updated_at=now() where id=c.id;
 else raise exception 'Unknown queue action'; end if;
 insert into studio_core.posting_events(copy_id,state,evidence) values(c.id,p_action,jsonb_build_object('listing_id',listing,'actor',auth.uid()));
 return jsonb_build_object('ok',true);
end $$;

-- Called only by the handoff Edge Function. Bearer capability is scoped to one copy and expires.
create function public.studio_posting_transfer(p_token text,p_action text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transfer'; end if;
 select * into c from studio_core.posting_copies where transfer_hash=encode(extensions.digest(p_token,'sha256'),'hex') and transfer_expires>now() for update;
 if c.id is null or c.state<>'filling' or not exists(select 1 from studio_core.members where user_id=c.owner_id and enabled)
 then raise exception 'Transfer expired or already completed'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Product changed or sold'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id;
 if p_action='read' then return jsonb_build_object('id',c.id,'revision',c.revision,'item',c.draft,'profile_id',a.profile_id,'account_label',a.label); end if;
 if p_action='filled' then
  if p_evidence->>'profile_id' is distinct from a.profile_id or (p_evidence->>'photo_count')::integer is distinct from jsonb_array_length(c.draft->'images')
  then raise exception 'Account or photo verification failed'; end if;
 elsif p_action<>'error' then raise exception 'Invalid transfer action'; end if;
 update studio_core.posting_copies set state=p_action,issue=case when p_action='error' then left(p_evidence->>'error',500) else null end,
  transfer_hash=null,transfer_expires=null,updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state,evidence) values(c.id,p_action,p_evidence-'token');
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.studio_posting_accounts(text,text,text),public.studio_posting_inventory(text,integer,integer),
 public.studio_posting_prepare(uuid,jsonb),public.studio_posting_queue(),public.studio_posting_claim(uuid,integer),
 public.studio_posting_result(uuid,integer,text,text),public.studio_posting_transfer(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_accounts(text,text,text),public.studio_posting_inventory(text,integer,integer),
 public.studio_posting_prepare(uuid,jsonb),public.studio_posting_queue(),public.studio_posting_claim(uuid,integer),public.studio_posting_result(uuid,integer,text,text) to authenticated;
grant execute on function public.studio_posting_transfer(text,text,jsonb) to service_role;

-- Availability changes invalidate copies even when the queue page is closed.
create function studio_core.posting_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if studio_core.posting_digest(new)=studio_core.posting_digest(old) then return new; end if;
 if new.is_active is not true or new.status is distinct from 'active' or coalesce(new.quantity,1)<=0 then
  update studio_core.posting_copies set state=case when state in ('filled','submitted','live') then 'remove_needed' else 'cancelled' end,
   transfer_hash=null,issue='Source is no longer available; inspect any destination draft or listing',updated_at=now()
  where source_id=new.id and state not in ('cancelled','remove_needed');
 else
  update studio_core.posting_copies set state='stale',transfer_hash=null,issue='Source details changed; prepare again',updated_at=now()
  where source_id=new.id and state in ('prepared','filling','error');
 end if;
 return new;
end $$;
revoke all on function studio_core.posting_source_changed() from public,anon,authenticated,service_role;
create trigger studio_posting_source_changed after update on public.active_listings for each row execute function studio_core.posting_source_changed();
