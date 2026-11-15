create table studio_core.export_sets (
 inventory_id text primary key references studio_core.inventory(id),
 selection jsonb not null,
 images jsonb not null check(jsonb_typeof(images)='array' and jsonb_array_length(images) between 1 and 10),
 verified_at timestamptz not null default now()
);
alter table studio_core.export_sets enable row level security;
alter table studio_core.export_sets force row level security;
revoke all on studio_core.export_sets from public,anon,authenticated,service_role;

create function studio_core.export_preview(p_item text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select jsonb_build_object('id',a.inventory_id,'revision',a.revision,'photo_revision',s.revision,
 'title',a.fields->>'title','description',a.fields->>'description','condition',a.fields->>'condition',
 'price',a.fields->>'price','category',a.fields->>'category','model',a.fields->>'model','images',e.images)
 into snapshot from studio_core.listing_authoring a join studio_core.photo_selection s using(inventory_id)
 join studio_core.export_sets e using(inventory_id)
 where a.inventory_id=p_item and a.revision=p_revision and s.exports_verified and e.selection=s.selection;
 if snapshot is null then raise exception 'Current revision has no verified JPEG set' using errcode='40001'; end if;
 return snapshot;
end $$;

create function public.studio_export_preview(p_item text,p_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$ select studio_core.export_preview(p_item,p_revision); $$;

create function studio_core.approve_export(p_item text,p_revision bigint,p_snapshot jsonb) returns bigint
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
create function public.studio_approve_export(p_item text,p_revision bigint,p_snapshot jsonb) returns bigint
language sql security invoker set search_path='' as $$ select studio_core.approve_export(p_item,p_revision,p_snapshot); $$;
revoke all on function studio_core.export_preview(text,bigint),public.studio_export_preview(text,bigint),
studio_core.approve_export(text,bigint,jsonb),public.studio_approve_export(text,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function studio_core.export_preview(text,bigint),public.studio_export_preview(text,bigint),
studio_core.approve_export(text,bigint,jsonb),public.studio_approve_export(text,bigint,jsonb) to authenticated;
