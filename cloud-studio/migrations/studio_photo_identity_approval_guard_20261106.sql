-- Release guard for exact physical identity + actual warehouse-photo cover.
-- All seller fields, selected photos and approval history are retained.
create or replace function studio_core.assert_releasable_photo_identity(p_item text)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not studio_core.is_member() then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 if not exists (
   select 1
   from studio_core.inventory i
   join studio_core.product_identity p on p.inventory_id=i.id
   join studio_core.photo_selection s on s.inventory_id=i.id
   join studio_core.photo_assets photo on photo.sha256=s.selection->0->>'sha'
   where i.id=p_item and i.lifecycle='current'
     and p.verification_status='verified_exact'
     and coalesce(jsonb_array_length(s.selection),0) between 1 and 10
     and s.selection->0->>'kind'='real'
     and photo.cloud_verified_at is not null
 ) then raise exception 'Verify the exact physical product and select an actual warehouse photo as cover before approving or handing off'
   using errcode='23514';
 end if;
end $$;
revoke all on function studio_core.assert_releasable_photo_identity(text) from public,anon,authenticated,service_role;
grant execute on function studio_core.assert_releasable_photo_identity(text) to authenticated;

create or replace function public.studio_approve_export(p_item text,p_revision bigint,p_snapshot jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
begin
 perform studio_core.assert_releasable_photo_identity(p_item);
 return studio_core.approve_export(p_item,p_revision,p_snapshot);
end $$;
revoke all on function public.studio_approve_export(text,bigint,jsonb) from public,anon,service_role;
grant execute on function public.studio_approve_export(text,bigint,jsonb) to authenticated;

create or replace function public.studio_issue_handoff(p_item text,p_revision bigint)
returns text language plpgsql security invoker set search_path='' as $$
begin
 perform studio_core.assert_releasable_photo_identity(p_item);
 return studio_core.issue_handoff(p_item,p_revision);
end $$;
revoke all on function public.studio_issue_handoff(text,bigint) from public,anon,service_role;
grant execute on function public.studio_issue_handoff(text,bigint) to authenticated;

with unsafe as (
  select a.inventory_id,a.revision
  from studio_core.listing_authoring a
  join studio_core.inventory i on i.id=a.inventory_id
  left join studio_core.product_identity p on p.inventory_id=a.inventory_id
  left join studio_core.photo_selection s on s.inventory_id=a.inventory_id
  where i.lifecycle='current' and a.status='approved'
   and (p.verification_status is distinct from 'verified_exact'
    or s.selection->0->>'kind' is distinct from 'real')
), audit as (
 insert into studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
 select inventory_id,'invalidated',revision,
        jsonb_build_object('reason','2026-11-06 photo/identity safety audit','preserved_seller_fields',true,'preserved_photo_order',true),null
 from unsafe
 returning inventory_id
)
update studio_core.listing_authoring a
set status='review',updated_at=now()
where a.inventory_id in (select inventory_id from audit) and a.status='approved';
