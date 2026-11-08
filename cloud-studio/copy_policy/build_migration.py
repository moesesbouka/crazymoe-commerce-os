"""Generate the database copy boundary from the same rules used by intake."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
rules=(root/'copy_policy/policy.json').read_text().strip()
sql=r'''
-- Automatic content is product facts only. Seller edits remain verbatim.
create or replace function studio_core.copy_rules() returns jsonb language sql immutable set search_path='' as $rules$
 select $json$RULES$json$::jsonb
$rules$;
create or replace function studio_core.machine_fragment(p_text text) returns text language plpgsql immutable set search_path='' as $$
declare s text; out_parts text[]:='{}'; changed boolean:=false; rules jsonb:=studio_core.copy_rules();
begin
 foreach s in array regexp_split_to_array(p_text,'(?<=[.!?;])\s+') loop
  if s ~* (rules->>'assessment') or regexp_replace(trim(s),'^[^A-Za-z0-9]+','') ~* (rules->>'photo_comment') then changed:=true;
  else out_parts:=array_append(out_parts,trim(s));end if;
 end loop;
 if not changed then return p_text;end if;
 return regexp_replace(array_to_string(out_parts,' '),'[ ;]+$','');
end $$;
create or replace function studio_core.machine_text(p_text text,p_kind text default 'description') returns text language plpgsql immutable set search_path='' as $$
declare line text; head text; original text; m text[]; replacement text; parts text[]:='{}'; private boolean:=false; changed boolean:=false; rules jsonb:=studio_core.copy_rules();
begin
 if p_text is null then return null;end if;
 if p_kind='title' then return rtrim(regexp_replace(p_text,rules->>'title_suffix','','i'),' -–—');end if;
 foreach line in array string_to_array(p_text,E'\n') loop
  original:=line;head:=regexp_replace(trim(line),'^[^A-Za-z0-9]+','');
  if head ~* (rules->>'public_section') then private:=false;
  elsif head ~* (rules->>'private_section') then private:=true;end if;
  if private or head ~* (rules->>'drop_line') then changed:=changed or length(trim(line))>0;continue;end if;
  for m in select regexp_matches(line,'\([^()]*\)','g') loop
   replacement:=studio_core.machine_fragment(substr(m[1],2,length(m[1])-2));
   line:=replace(line,m[1],case when trim(replacement)='' then '' else '('||replacement||')' end);
  end loop;
  line:=studio_core.machine_fragment(line);
  if line is distinct from original then
   changed:=true;line:=regexp_replace(trim(line),'\s+([.,;:])','\1','g');
   if line='' and head<>'' then continue;end if;
  end if;
  parts:=array_append(parts,line);
 end loop;
 if not changed then return p_text;end if;
 return btrim(regexp_replace(array_to_string(parts,E'\n'),E'\n{3,}',E'\n\n','g'),E' \n\r\t');
end $$;
create or replace function studio_core.clean_copy(p_text text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('description',studio_core.machine_text(p_text),'internal_notes','')
$$;
create or replace function studio_core.machine_fields(p_fields jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,case when key in ('title','description') then to_jsonb(studio_core.machine_text(value#>>'{}',key)) else value end),'{}')
 from jsonb_each(coalesce(p_fields,'{}')) where key in ('title','description','model','brand','price','category','source_url') and jsonb_typeof(value)='string'
$$;
create or replace function studio_core.without_automatic_notes(p_value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_value)='object' then
  select coalesce(jsonb_object_agg(key,studio_core.without_automatic_notes(value)),'{}') into result from jsonb_each(p_value)
  where key !~* '(note|observation|needs_seller|reason|warning|original_description|condition|assessment|limitation|internal)' and key<>'description';
  return result;
 elsif jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(studio_core.without_automatic_notes(value)),'[]') into result from jsonb_array_elements(p_value);return result;
 end if;
 return p_value;
end $$;
create or replace function studio_core.enforce_generated_copy() returns trigger language plpgsql set search_path='' as $$
begin
 new.fields:=studio_core.machine_fields(new.fields);
 if tg_table_name='field_proposals' then
  new.evidence:=studio_core.without_automatic_notes(new.evidence);
  if new.evidence ? 'suggestion' then new.evidence:=jsonb_set(new.evidence,'{suggestion}',new.fields);end if;
 end if;
 return new;
end $$;
create or replace function studio_core.enforce_manual_notes() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;
begin
 if auth.uid() is not null and current_setting('studio.manual_edit',true)=auth.uid()::text and studio_core.is_member() then return new;end if;
 if tg_op='INSERT' then new.fields:=studio_core.machine_fields(new.fields);return new;end if;
 foreach k in array array['title','description'] loop
  if new.fields->k is distinct from old.fields->k then
   if exists(select 1 from studio_core.field_provenance where inventory_id=new.inventory_id and field_name=k and source='seller') then
    if old.fields ? k then new.fields:=jsonb_set(new.fields,array[k],old.fields->k);else new.fields:=new.fields-k;end if;
   elsif new.fields ? k then new.fields:=jsonb_set(new.fields,array[k],to_jsonb(studio_core.machine_text(new.fields->>k,k)));end if;
  end if;
 end loop;
 -- An automated operation can neither insert notes nor replace a seller's notes/condition.
 foreach k in array array['notes','condition'] loop
  if old.fields ? k then new.fields:=jsonb_set(new.fields,array[k],old.fields->k);
  else new.fields:=new.fields-k;end if;
 end loop;
 return new;
end $$;
create or replace function studio_core.enforce_research_notes() returns trigger language plpgsql set search_path='' as $$
begin new.research:=studio_core.without_automatic_notes(new.research);return new;end $$;
create or replace trigger zz_product_facts_only before insert or update on studio_core.field_proposals for each row execute function studio_core.enforce_generated_copy();
create or replace trigger product_facts_only before insert or update on studio_core.generated_copy for each row execute function studio_core.enforce_generated_copy();
create or replace trigger manual_notes_only before insert or update of fields on studio_core.listing_authoring for each row execute function studio_core.enforce_manual_notes();
create or replace trigger no_research_notes before insert or update on studio_core.research_evidence for each row execute function studio_core.enforce_research_notes();
'''.replace('RULES',rules)
# Existing RPCs retain their membership, revision and edit-history checks.
base=root/'copy_policy/templates'
seller=(base/'seller_patch.sql').read_text().replace('  UPDATE studio_core.listing_authoring SET fields=merged',"  PERFORM set_config('studio.manual_edit',actor_id::text,true);\n  UPDATE studio_core.listing_authoring SET fields=merged").replace("  RETURN jsonb_build_object('id'","  PERFORM set_config('studio.manual_edit','',true);\n  RETURN jsonb_build_object('id'")
refresh=(base/'studio_refresh_copy_suggestion.sql').read_text().replace("jsonb_build_object('original_description',original,'internal_notes',result->>'internal_notes','method','deterministic-cleanup-v1')","jsonb_build_object('method','product-facts-only-v2')")
read=(base/'read_state.sql').read_text().replace("'research',r.research","'research',studio_core.without_automatic_notes(r.research)")
start=read.index("  'visual_proposal',")
end=read.index("  'proposal_revision'",start)
read=read[:start]+"  'visual_proposal',case when fresh.valid then v.evidence else null end,\n"+read[end:]
sql+='\n'+seller.rstrip()+';\n'+refresh.rstrip()+';\n'+read.rstrip()+';\n'
for name,args in [('copy_rules',''),('machine_fragment','text'),('machine_text','text,text'),('clean_copy','text'),('machine_fields','jsonb'),('without_automatic_notes','jsonb'),('enforce_generated_copy',''),('enforce_manual_notes',''),('enforce_research_notes','')]:
 sql+=f'\nrevoke all on function studio_core.{name}({args}) from public,anon,authenticated;'
(root/'migrations/manual_notes_only.sql').write_text(sql+'\n')
