-- Same ten-image rule at every write boundary; originals remain stored.
alter table studio_core.photo_selection add constraint studio_selection_max_ten check(jsonb_array_length(selection)<=10);
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.studio_finish_intake(uuid,uuid,jsonb)'::regprocedure);
 if position('between 1 and 12' in definition)=0 then raise exception 'Unexpected intake implementation';end if;
 execute replace(definition,'between 1 and 12','between 1 and 10');
 definition:=pg_get_functiondef('public.studio_render_status(text)'::regprocedure);
 if position('if s.exports_verified and exists' in definition)=0 then raise exception 'Unexpected render status implementation';end if;
 definition:=replace(definition,'if s.exports_verified and exists(select 1 from studio_core.export_sets where inventory_id=p_item and selection=s.selection) then result:=''ready'';',
 'if coalesce((studio_core.media_health(p_item)->>''export_ready'')::boolean,false) then result:=''ready'';');
 execute definition;
end $$;
