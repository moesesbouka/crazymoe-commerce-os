create table studio_core.handoffs(
 token_hash bytea primary key,approval_id bigint not null references studio_core.approval_events(id),
 issued_by uuid not null,expires_at timestamptz not null,claimed_at timestamptz
);
alter table studio_core.handoffs enable row level security;
alter table studio_core.handoffs force row level security;
revoke all on studio_core.handoffs from public,anon,authenticated,service_role;

create function studio_core.issue_handoff(p_item text,p_revision bigint) returns text
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; approval bigint; secret text;
begin
 snapshot:=studio_core.export_preview(p_item,p_revision);
 select e.id into strict approval from studio_core.approval_events e join studio_core.listing_authoring a using(inventory_id)
 where e.inventory_id=p_item and a.status='approved' and e.event='approved' and e.listing_revision=p_revision and e.payload=snapshot
 order by e.id desc limit 1 for share of a;
 secret:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into studio_core.handoffs values(sha256(convert_to(secret,'UTF8')),approval,auth.uid(),now()+interval '10 minutes',null);
 return secret;
end $$;
create function public.studio_issue_handoff(p_item text,p_revision bigint) returns text language sql security invoker
set search_path='' as $$ select studio_core.issue_handoff(p_item,p_revision); $$;

create function public.studio_claim_handoff(p_secret text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h studio_core.handoffs; snapshot jsonb;
begin
 if p_secret is null or p_secret !~ '^[a-f0-9]{64}$' then return null; end if;
 select * into h from studio_core.handoffs where token_hash=sha256(convert_to(p_secret,'UTF8'))
 and claimed_at is null and expires_at>now() for update;
 if not found then return null; end if;
 select e.payload into snapshot from studio_core.approval_events e join studio_core.listing_authoring a using(inventory_id)
 join studio_core.photo_selection s using(inventory_id) join studio_core.export_sets x using(inventory_id)
 where e.id=h.approval_id and e.event='approved' and a.status='approved' and a.revision=e.listing_revision
 and s.exports_verified and s.selection=x.selection and s.revision=(e.payload->>'photo_revision')::bigint
 and x.images=e.payload->'images' and exists(select 1 from studio_core.members where user_id=h.issued_by and enabled)
 for share of a,s,x;
 update studio_core.handoffs set claimed_at=now() where token_hash=h.token_hash;
 return snapshot;
end $$;
revoke all on function studio_core.issue_handoff(text,bigint),public.studio_issue_handoff(text,bigint),public.studio_claim_handoff(text)
 from public,anon,authenticated,service_role;
grant execute on function studio_core.issue_handoff(text,bigint),public.studio_issue_handoff(text,bigint) to authenticated;
grant execute on function public.studio_claim_handoff(text) to service_role;
