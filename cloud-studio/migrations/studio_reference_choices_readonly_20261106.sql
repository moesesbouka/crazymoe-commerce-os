-- Expose only owner-authorized, cloud-verified manufacturer/retailer reference metadata.
-- Never expose storage paths, private images, or raw source metadata through this RPC.
create or replace function public.studio_reference_choices(p_item text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not studio_core.is_member() then
  raise exception 'Studio access denied' using errcode = '42501';
 end if;
 return (
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', r.reference_id,
   'label', left(coalesce(r.source_metadata->>'label','Manufacturer/retailer reference'),160),
   'source_url', r.source_metadata->>'source_url',
   'prepared', exists (
     select 1 from studio_core.photo_choices c
     where c.inventory_id=r.inventory_id and c.source->>'kind'='manufacturer'
       and c.source->>'id'=r.reference_id)
 ) order by r.reference_id), '[]'::jsonb)
 from studio_core.reference_assets r
 where r.inventory_id=p_item and r.cloud_verified_at is not null
 );
end $$;
revoke all on function public.studio_reference_choices(text) from public, anon, authenticated, service_role;
grant execute on function public.studio_reference_choices(text) to authenticated;
