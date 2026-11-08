-- A choice preserves the exact source metadata, selected style and verified JPEG.
create table studio_core.photo_choices (
 inventory_id text references studio_core.inventory(id), position integer not null,
 choice text not null, source jsonb not null, image jsonb not null,
 primary key(inventory_id,choice), unique(inventory_id,position)
);
create table studio_core.photo_changes (
 inventory_id text references studio_core.inventory(id), revision bigint not null,
 before_order text[] not null, after_order text[] not null,
 listing_revision bigint not null, actor uuid not null, changed_at timestamptz not null default now(),
 primary key(inventory_id,revision)
);
alter table studio_core.photo_choices enable row level security;
alter table studio_core.photo_choices force row level security;
alter table studio_core.photo_changes enable row level security;
alter table studio_core.photo_changes force row level security;
revoke all on studio_core.photo_choices,studio_core.photo_changes from public,anon,authenticated,service_role;
insert into studio_core.photo_choices
select e.inventory_id,i.pos,i.image->>'sha',e.selection->(i.pos::int-1),i.image
from studio_core.export_sets e join studio_core.photo_selection s using(inventory_id)
cross join lateral jsonb_array_elements(e.images) with ordinality i(image,pos)
where s.exports_verified and s.selection=e.selection;

create function public.studio_photo_choices(p_item text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select jsonb_build_object('revision',s.revision,'listing_revision',a.revision,
 'choices',(select coalesce(jsonb_agg(jsonb_build_object('id',c.choice,'source',c.source,'position',c.position) order by c.position),'[]') from studio_core.photo_choices c where c.inventory_id=p_item),
 'selected',(select coalesce(jsonb_agg(i.image->>'sha' order by pos),'[]') from jsonb_array_elements(e.images) with ordinality i(image,pos)),
 'previous',(select before_order from studio_core.photo_changes where inventory_id=p_item and revision=s.revision))
 into strict result from studio_core.photo_selection s join studio_core.listing_authoring a using(inventory_id)
 left join studio_core.export_sets e using(inventory_id) where s.inventory_id=p_item;
 return result;
end $$;

create function public.studio_save_photo_choices(p_item text,p_listing_revision bigint,p_photo_revision bigint,p_choices text[]) returns bigint
language plpgsql security definer set search_path='' as $$
declare a studio_core.listing_authoring; s studio_core.photo_selection; e studio_core.export_sets; sources jsonb; files jsonb; old_order text[];
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 select * into strict e from studio_core.export_sets where inventory_id=p_item for update;
 if a.revision is distinct from p_listing_revision or s.revision is distinct from p_photo_revision
 or e.selection is distinct from s.selection or not s.exports_verified then raise exception 'Selection changed' using errcode='40001'; end if;
 if a.status not in ('review','approved') then raise exception 'Product cannot be edited';end if;
 if coalesce(cardinality(p_choices),0) not between 1 and 10 or (select count(distinct v) from unnest(p_choices)v)<>cardinality(p_choices)
 then raise exception 'Select one to ten different photos';end if;
 select jsonb_agg(c.source order by pos),jsonb_agg(c.image order by pos) into sources,files
 from unnest(p_choices) with ordinality u(choice,pos)
 join studio_core.photo_choices c on c.inventory_id=p_item and c.choice=u.choice;
 if jsonb_array_length(files) is distinct from cardinality(p_choices) then raise exception 'Unverified photo choice';end if;
 if files=e.images and sources=e.selection then return s.revision;end if;
 select array_agg(i.image->>'sha' order by pos) into old_order from jsonb_array_elements(e.images) with ordinality i(image,pos);
 insert into studio_core.photo_changes(inventory_id,revision,before_order,after_order,listing_revision,actor)
 values(p_item,s.revision+1,old_order,p_choices,a.revision,auth.uid());
 update studio_core.photo_selection set selection=sources,revision=s.revision+1 where inventory_id=p_item;
 update studio_core.export_sets set selection=sources,images=files,verified_at=now() where inventory_id=p_item;
 if a.status='approved' then
  insert into studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
  values(p_item,'invalidated',a.revision,jsonb_build_object('reason','photo_selection','photo_revision',s.revision+1),auth.uid());
  update studio_core.listing_authoring set status='review',updated_at=now() where inventory_id=p_item;
 end if;
 return s.revision+1;
end $$;
revoke all on function public.studio_photo_choices(text),public.studio_save_photo_choices(text,bigint,bigint,text[]) from public,anon,service_role;
grant execute on function public.studio_photo_choices(text),public.studio_save_photo_choices(text,bigint,bigint,text[]) to authenticated;
