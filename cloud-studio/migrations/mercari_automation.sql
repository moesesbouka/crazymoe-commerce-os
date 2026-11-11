begin;
create table studio_core.mercari_taxonomy (
 owner_id uuid primary key references auth.users(id), paths jsonb not null default '[]',
 updated_at timestamptz not null default now()
);
alter table studio_core.mercari_taxonomy enable row level security;
alter table studio_core.mercari_taxonomy force row level security;
revoke all on studio_core.mercari_taxonomy from public,anon,authenticated,service_role;
alter table studio_core.mercari_queue add column handoff jsonb not null default '{}';
create function studio_core.mercari_categories(p_paths jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare paths jsonb; result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if p_paths is not null then
  if jsonb_typeof(p_paths)<>'array' or jsonb_array_length(p_paths)>6000 or octet_length(p_paths::text)>2000000 then raise exception 'Invalid category import';end if;
  if exists(select 1 from jsonb_array_elements(p_paths) p where jsonb_typeof(p)<>'array' or jsonb_array_length(p) not between 1 and 6)
  or exists(select 1 from jsonb_array_elements(p_paths) p cross join lateral jsonb_array_elements(p) v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200)
  then raise exception 'Invalid category path';end if;
  select coalesce(jsonb_agg(path order by path::text),'[]') into paths from (
   select distinct value as path from jsonb_array_elements(p_paths||coalesce((select t.paths from studio_core.mercari_taxonomy t where owner_id=auth.uid()),'[]'))
  ) x;
  insert into studio_core.mercari_taxonomy(owner_id,paths) values(auth.uid(),paths)
  on conflict(owner_id) do update set paths=excluded.paths,updated_at=now();
 end if;
 select jsonb_build_object('paths',t.paths,'updated_at',t.updated_at) into result from studio_core.mercari_taxonomy t where owner_id=auth.uid();
 return coalesce(result,'{"paths":[]}'::jsonb);
end $$;
create function studio_core.mercari_handoff(p_id uuid,p_revision integer,p_event text,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q studio_core.mercari_queue;src jsonb;link text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 if coalesce(p_event,'') not in ('filled','needs_attention','error','published') or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>10000 then raise exception 'Invalid fill result';end if;
 select * into strict q from studio_core.mercari_queue where id=p_id and owner_id=auth.uid() for update;
 if q.revision is distinct from p_revision then raise exception 'Listing changed while the Mercari form was open' using errcode='40001';end if;
 if q.state not in ('ready','needs_details') then raise exception 'This listing is already closed';end if;
 src:=studio_core.mercari_source(q.source_kind,q.source_id);
 if p_event<>'error' and (src is null or not coalesce((src->>'available')::boolean,false) or src->>'digest' is distinct from q.source_digest)
 then raise exception 'Inventory changed during the Mercari handoff' using errcode='40001';end if;
 if p_event='published' then
  if coalesce(p_details->>'url','') !~ '^https://www[.]mercari[.]com/us/item/m[0-9]+/?$' then raise exception 'Invalid Mercari listing link';end if;
  link:='https://www.mercari.com/us/item/'||substring(p_details->>'url' from '/us/item/(m[0-9]+)')||'/';
  q.state:='posted';q.listing_url:=link;q.revision:=q.revision+1;
 end if;
 update studio_core.mercari_queue set state=q.state,listing_url=q.listing_url,revision=q.revision,
 handoff=jsonb_build_object('state',p_event,'details',p_details,'recorded_at',now()),updated_at=now() where id=q.id returning * into q;
 insert into studio_core.mercari_events(queue_id,actor,event,revision,payload) values(q.id,auth.uid(),'browser_'||p_event,q.revision,p_details);
 return to_jsonb(q);
end $$;
create function public.studio_mercari_categories(p_paths jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$select studio_core.mercari_categories(p_paths)$$;
create function public.studio_mercari_handoff(p_id uuid,p_revision integer,p_event text,p_details jsonb) returns jsonb
language sql security invoker set search_path='' as $$select studio_core.mercari_handoff(p_id,p_revision,p_event,p_details)$$;
revoke all on function studio_core.mercari_categories(jsonb),studio_core.mercari_handoff(uuid,integer,text,jsonb),public.studio_mercari_categories(jsonb),public.studio_mercari_handoff(uuid,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function studio_core.mercari_categories(jsonb),studio_core.mercari_handoff(uuid,integer,text,jsonb),public.studio_mercari_categories(jsonb),public.studio_mercari_handoff(uuid,integer,text,jsonb) to authenticated;
commit;
