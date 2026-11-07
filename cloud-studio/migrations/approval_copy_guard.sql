create or replace function studio_core.approve_export(p_item text,p_revision bigint,p_snapshot jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare current_snapshot jsonb; event_id bigint; previous_status text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select status into strict previous_status from studio_core.listing_authoring where inventory_id=p_item for update;
 perform 1 from studio_core.photo_selection where inventory_id=p_item for update;
 perform 1 from studio_core.export_sets where inventory_id=p_item for share;
 current_snapshot := studio_core.export_preview(p_item,p_revision);
 if p_snapshot is distinct from current_snapshot then raise exception 'Preview changed' using errcode='40001'; end if;
 if previous_status not in ('review','approved') then raise exception 'Product cannot be approved in current status'; end if;
 if coalesce(trim(current_snapshot->>'title'),'')='' or coalesce(trim(current_snapshot->>'description'),'')=''
 or coalesce(current_snapshot->>'condition','') not in ('New','Used - Like New','Used - Good','Used - Fair','For parts or not working')
 or coalesce(current_snapshot->>'price','') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then raise exception 'Complete listing fields before approving'; end if;
 if (current_snapshot->>'price')::numeric<=0 then raise exception 'Price must be positive'; end if;
 if concat_ws(E'\n',current_snapshot->>'title',current_snapshot->>'description') ~*
 '(MANUFACTURER MODEL REFERENCE|IDENTIFICATION[ /]+SOURCE CORROBORATION|SELLER REVIEW REQUIRED|INTERNAL (SKU AUDIT|VERIFICATION NOTES)|AI (IDENTIFICATION|PROCESSING) NOTES|MANIFEST CORROBORATION|SELLER CHECK|Best Buy SKU[ ]*:|Retailer status[ ]*:|English Opens a New Window|carton identified|Confidence score[ ]*:|OCR output[ ]*:|EXACT MODEL LABEL NOT PHOTOGRAPHED)' then
  raise exception 'Remove internal research or retailer boilerplate before approving';
 end if;
 if previous_status='approved' then
  select id into event_id from studio_core.approval_events where inventory_id=p_item and event='approved'
  and listing_revision=p_revision and payload=current_snapshot order by id desc limit 1;
 end if;
 if event_id is null then
  insert into studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
  values(p_item,'approved',p_revision,current_snapshot,auth.uid()) returning id into event_id;
  update studio_core.listing_authoring set status='approved',updated_at=now() where inventory_id=p_item;
 end if;
 return event_id;
end $$;
