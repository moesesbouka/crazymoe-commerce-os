-- Explicit owner-requested copy cleanup. Preserves saved seller fields and facts.
create or replace function studio_core.clean_copy(p_text text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare line text; head text; visible text[]:='{}'; private_notes text[]:='{}'; internal boolean:=false; disclosure boolean;
begin
 foreach line in array string_to_array(coalesce(p_text,''),E'\n') loop
  head:=regexp_replace(trim(line),'^[^A-Za-z0-9]+','','g');
  disclosure:=line ~* '(exposed wir|damaged|cracked|broken|missing|not included|not represented as included|does not (work|power)|sold for parts|carton [0-9]+ of [0-9]+|untested|not (been )?(function-)?tested|not been inspected|needs repair|incomplete|only)';
  if head ~* '^(MANUFACTURER MODEL REFERENCE|IDENTIFICATION[ /]+SOURCE CORROBORATION|SELLER REVIEW REQUIRED|INTERNAL (SKU AUDIT|VERIFICATION NOTES)|AI (IDENTIFICATION|PROCESSING) NOTES|MANIFEST CORROBORATION|SELLER CHECK)' then
   internal:=true; private_notes:=array_append(private_notes,line);
  elsif head ~* '^(ACTUAL ITEM[ /&]+(LIMITATIONS|CONDITION|INCLUDED PARTS)|PHYSICALLY RECORDED DETAILS)' then
   internal:=false; private_notes:=array_append(private_notes,line);
  elsif head ~* '^(Best Buy SKU|Retailer status|English Opens a New Window|Confidence score|OCR output|Candidate identity|Source[ ]*:|EXACT MODEL LABEL NOT PHOTOGRAPHED)' and not disclosure then
   private_notes:=array_append(private_notes,line);
  else
   if head ~* '^(PRODUCT OVERVIEW|KEY FEATURES|MAIN FEATURES|FEATURES|TECHNICAL SPECIFICATIONS|MANUFACTURER DESIGN|CONDITION|DAMAGE|MISSING PARTS|INCLUDED ACCESSORIES)' then internal:=false; end if;
   if internal and not disclosure then private_notes:=array_append(private_notes,line);
   elsif head ~* '^(First photos show the actual inventory item|The first photos show the actual item|Any retailer/manufacturer images are reference pictures only|Confirm actual condition, missing parts, hardware and accessories before listing)' then private_notes:=array_append(private_notes,line);
   else visible:=array_append(visible,line); end if;
  end if;
 end loop;
 return jsonb_build_object('description',trim(regexp_replace(array_to_string(visible,E'\n'),E'\n{3,}',E'\n\n','g')),'internal_notes',array_to_string(private_notes,E'\n'));
end $$;
revoke all on function studio_core.clean_copy(text) from public,anon,authenticated,service_role;

create or replace function public.studio_refresh_copy_suggestion(p_item text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare listing studio_core.listing_authoring; candidate studio_core.generated_copy; result jsonb; original text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict listing from studio_core.listing_authoring where inventory_id=p_item for update;
 if listing.revision<>p_revision then raise exception 'Listing changed; refresh before generating a suggestion' using errcode='40001';end if;
 select * into candidate from studio_core.generated_copy where inventory_id=p_item;
 original:=coalesce(nullif(listing.fields->>'description',''),candidate.fields->>'description','');
 if length(trim(original))=0 then raise exception 'No supported description exists yet. Add product facts first.';end if;
 result:=studio_core.clean_copy(original);
 if length(trim(result->>'description'))=0 then raise exception 'Only internal notes are available. Add product facts first.';end if;
 insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence)
 values(p_item,jsonb_build_object('description',result->>'description'),p_revision,'owner_requested_copy_cleanup',jsonb_build_object('original_description',original,'internal_notes',result->>'internal_notes','method','deterministic-cleanup-v1'));
 insert into studio_core.generated_copy(inventory_id,fields,source,based_on_revision)
 values(p_item,coalesce(candidate.fields,'{}'::jsonb)||jsonb_build_object('description',result->>'description'),'owner_requested_copy_cleanup',p_revision)
 on conflict(inventory_id) do update set fields=excluded.fields,source=excluded.source,based_on_revision=excluded.based_on_revision,created_at=now();
 return jsonb_build_object('description',result->>'description','based_on_revision',p_revision);
end $$;
revoke all on function public.studio_refresh_copy_suggestion(text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.studio_refresh_copy_suggestion(text,bigint) to authenticated;
