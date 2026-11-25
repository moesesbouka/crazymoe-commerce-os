-- Retain private administrative views for authenticated Studio members.
do $$
declare obj text; definition text;
begin
 foreach obj in array array['admin_listings','private_inventory'] loop
  select trim(trailing ';' from view_definition) into strict definition from studio_migration.legacy_access_before
   where relation in (obj,'public.'||obj);
  if position('WHERE' in definition)>0 then
   definition := replace(definition,'WHERE','WHERE (select studio_core.is_member()) AND');
  elsif position('ORDER BY' in definition)>0 then
   definition := replace(definition,'ORDER BY','WHERE (select studio_core.is_member()) ORDER BY');
  else raise exception 'Unexpected source view shape'; end if;
  execute format('create or replace view public.%I with (security_barrier=true) as %s with local check option',obj,definition);
  execute format('grant select,insert,update,delete on public.%I to authenticated',obj);
 end loop;
end $$;
