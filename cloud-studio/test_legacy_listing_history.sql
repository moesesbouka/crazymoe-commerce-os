begin;
do $$
declare item public.active_listings; before_doc jsonb; after_doc jsonb; count_before bigint; h record;
begin
 select * into strict item from public.active_listings order by id limit 1 for update;
 before_doc:=to_jsonb(item);
 select count(*) into count_before from studio_core.legacy_listing_revisions where listing_id=item.id;
 update public.active_listings set last_seen_at=clock_timestamp() where id=item.id;
 if (select count(*) from studio_core.legacy_listing_revisions where listing_id=item.id)<>count_before then
  raise exception 'Heartbeat duplicated full history'; end if;
 select to_jsonb(t) into before_doc from public.active_listings t where id=item.id;
 update public.active_listings set title=coalesce(title,'')||' [transactional history probe]' where id=item.id;
 select to_jsonb(t) into after_doc from public.active_listings t where id=item.id;
 select * into strict h from studio_core.legacy_listing_revisions where listing_id=item.id order by revision_id desc limit 1;
 if h.operation<>'UPDATE' or h.before_row is distinct from before_doc or h.after_row is distinct from after_doc then
  raise exception 'Full before/after history mismatch'; end if;
 if (select count(*) from studio_core.legacy_listing_revisions where listing_id=item.id)<>count_before+1 then
  raise exception 'Unexpected revision count'; end if;
 if has_table_privilege('anon','studio_core.legacy_listing_revisions','SELECT')
 or has_table_privilege('authenticated','studio_core.legacy_listing_revisions','SELECT')
 or has_table_privilege('service_role','studio_core.legacy_listing_revisions','UPDATE')
 or has_function_privilege('anon','studio_core.capture_legacy_listing_revision()','EXECUTE') then
  raise exception 'History privileges exposed'; end if;
end $$;
do $$
declare fixture public.active_listings; doc jsonb; captured record;
begin
 if exists(select 1 from public.active_listings where id=-9046110601 or facebook_id='99999999046110601') then
  raise exception 'Fixture collision'; end if;
 select * into strict fixture from public.active_listings order by id limit 1;
 fixture.id:=-9046110601;
 fixture.facebook_id:='99999999046110601';
 insert into public.active_listings select (fixture).*;
 select to_jsonb(t) into doc from public.active_listings t where id=fixture.id;
 select * into strict captured from studio_core.legacy_listing_revisions where listing_id=fixture.id;
 if captured.operation<>'INSERT' or captured.before_row is not null or captured.after_row is distinct from doc then
  raise exception 'Insert evidence mismatch'; end if;
 delete from public.active_listings where id=fixture.id;
 select * into strict captured from studio_core.legacy_listing_revisions where listing_id=fixture.id order by revision_id desc limit 1;
 if captured.operation<>'DELETE' or captured.after_row is not null or captured.before_row is distinct from doc then
  raise exception 'Delete evidence mismatch'; end if;
 if (select count(*) from studio_core.legacy_listing_revisions where listing_id=fixture.id)<>2 then
  raise exception 'Insert/delete history incomplete'; end if;
end $$;
rollback;
