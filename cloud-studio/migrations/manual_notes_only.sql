
-- Automatic content is product facts only. Seller edits remain verbatim.
create or replace function studio_core.copy_rules() returns jsonb language sql immutable set search_path='' as $rules$
 select $json${
  "private_section": "^(ACTUAL (WAREHOUSE UNIT|ITEM|INVENTORY|CONDITION|FEATURES)|ITEM CONDITION|CONDITION( NOTES)?|CRITICAL SAFETY|INTERNAL |AI (IDENTIFICATION|PROCESSING)|SELLER (REVIEW|CHECK)|IDENTIFICATION[ /]+SOURCE|MANIFEST CORROBORATION|PHYSICALLY RECORDED|WHAT THE WAREHOUSE|ONLY CARTON [0-9]+ OF)",
  "public_section": "^(PRODUCT OVERVIEW|OVERVIEW|KEY FEATURES|MAIN FEATURES|PRODUCT FEATURES|FEATURES|TECHNICAL SPECIFICATIONS|SPECIFICATIONS|(PUBLISHED )?MANUFACTURER(-VERIFIED)? (MODEL DETAILS|FEATURES|DESIGN|SPECIFICATIONS|TECHNICAL SPECIFICATIONS)|COMPLETE-MODEL DESIGN|MODEL (FEATURES|DIMENSIONS)|[A-Z -]+ SPECIFICATIONS)|^(Message with questions)",
  "drop_line": "^(MODEL CONFIRMATION|EXACT MODEL LABEL|MANUFACTURER MODEL REFERENCE|Best Buy SKU|Retailer status|English Opens a New Window|Confidence score|OCR output|Candidate identity|Source[ ]*:|Verified Authenticity|Official Serial Number|Origin: Official plate)",
  "assessment": "(untested|uninspected|unconfirmed|unverified|not (been )?(function-)?tested|not tested|not (been |yet |independently )?(confirmed|verified|established|demonstrated|inspected)|NOT confirmed|NOT been tested|must be confirmed|require(s)? confirmation|needs (repair|inspection)|cosmetic|structural condition|visibly worn|wear and tear|scratches|scuffs|dents|damaged|cracked|broken|exposed (wire|wiring|copper)|open(ed)? wiring|check (actual|the unit|charging)|confirm (actual|which|what|product|the model)|verify (actual|included|pieces|physical)|buyer (should|must)|before (purchas|listing|approving)|not (shown|visible|promised|claimed included|represented as|sold as|evidence that)|no (unpictured|tested-operation|working,)|do not (assume|connect)|(does|do) not establish|remain(s)? binding|not an operating claim|fully (working|functional)|excellent.*condition|tracks beautifully|like.new condition)|(visibly laid out|visibly present|visible (wear|damage)|condition (has|is)|condition[ ]*:|testing (has|is)|not (independently )?(established|measured|assumed)|not a promised|no .* represented as included|check (the photographed|exact physical)|confirm (your|inclusion)|verify (inclusion|seller|physical)|refer to .*photos for|ask about .*not shown|not (fully )?verified|not function-tested|unpictured|have not been|has not been|not verified functionality|carton identified|carton-only|photo.*(shows?|showing).*(box|packaging)|not an identification claim)|(Only [Cc]arton [0-9]+ of [0-9]+|refer to the actual item photographs|Power included in actual photos|manufacturer images illustrate|photo.*accessor|accessor.*photograph)",
  "photo_comment": "^(First photos|The first photos|First photographs|Any retailer/manufacturer images|Photos of the actual|Pictures show|These are model|These manufacturer features|These describe|Features refer to|The features below|The real warehouse item|The remote itself|Actual (battery|switch|condition|unit|operation)|Both cartons are required|Carton [0-9]+ and|This item is not|The pictured guide|An LG-branded box|The seller.s actual|The illuminated/assembled)",
  "title_suffix": "[ ]*[-\u2013\u2014]?[ ]*(\\((Untested|Unconfirmed|Needs Repair/Inspection)\\)|Untested Lock|Lock Untested|Untested|EXPOSED WIRING, Needs Repair/Inspection|Carton [0-9]+ of [0-9]+)[ ]*$"
}$json$::jsonb
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

CREATE OR REPLACE FUNCTION studio_core.seller_patch(p_id text, p_expected_revision bigint, p_patch jsonb, p_reason text DEFAULT 'seller edit'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE old_row studio_core.listing_authoring%ROWTYPE; merged jsonb; actor_id uuid := auth.uid(); k text;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM studio_core.members WHERE user_id=actor_id AND enabled) THEN
    RAISE EXCEPTION 'Studio access denied' USING ERRCODE='42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'Patch must be a nonempty object';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('title','description','price','condition','notes','model','category','source_url') OR jsonb_typeof(p_patch->k)<>'string' THEN
      RAISE EXCEPTION 'Unsupported field or non-string value: %',k;
    END IF;
  END LOOP;
  SELECT * INTO old_row FROM studio_core.listing_authoring WHERE inventory_id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory not found'; END IF;
  IF p_expected_revision IS NULL OR old_row.revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Listing changed; refresh before saving' USING ERRCODE='40001';
  END IF;
  merged := old_row.fields || p_patch;
  INSERT INTO studio_core.listing_revisions(inventory_id,before_revision,after_revision,old_fields,new_fields,actor,reason)
  VALUES(p_id,old_row.revision,old_row.revision+1,old_row.fields,merged,actor_id,coalesce(p_reason,'seller edit'));
  INSERT INTO studio_core.field_provenance(inventory_id,field_name,source,actor,protected)
  SELECT p_id,key,'seller',actor_id::text,true FROM jsonb_each(p_patch)
  ON CONFLICT(inventory_id,field_name) DO UPDATE SET source='seller',actor=excluded.actor,protected=true,updated_at=now();
  IF old_row.status='approved' THEN
    INSERT INTO studio_core.approval_events(inventory_id,event,listing_revision,payload,actor)
    VALUES(p_id,'invalidated',old_row.revision,jsonb_build_object('reason','seller content changed'),actor_id);
  END IF;
  PERFORM set_config('studio.manual_edit',actor_id::text,true);
  UPDATE studio_core.listing_authoring SET fields=merged,revision=revision+1,
    status=CASE WHEN status='listed' THEN 'listed' ELSE 'review' END,updated_at=now() WHERE inventory_id=p_id;
  PERFORM set_config('studio.manual_edit','',true);
  RETURN jsonb_build_object('id',p_id,'revision',old_row.revision+1,'fields',merged);
END; $function$;
CREATE OR REPLACE FUNCTION public.studio_refresh_copy_suggestion(p_item text, p_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 values(p_item,jsonb_build_object('description',result->>'description'),p_revision,'owner_requested_copy_cleanup',jsonb_build_object('method','product-facts-only-v2'));
 insert into studio_core.generated_copy(inventory_id,fields,source,based_on_revision)
 values(p_item,coalesce(candidate.fields,'{}'::jsonb)||jsonb_build_object('description',result->>'description'),'owner_requested_copy_cleanup',p_revision)
 on conflict(inventory_id) do update set fields=excluded.fields,source=excluded.source,based_on_revision=excluded.based_on_revision,created_at=now();
 return jsonb_build_object('description',result->>'description','based_on_revision',p_revision);
end $function$;
CREATE OR REPLACE FUNCTION studio_core.read_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from studio_core.members where user_id=auth.uid() and enabled) then
  raise exception 'Studio access denied' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'lifecycle',i.lifecycle,'fields',a.fields,'revision',a.revision,'status',a.status,
  'generated_candidate',g.fields,'identity',p.identity,'identity_status',p.verification_status,'identity_revision',p.revision,
  'research',studio_core.without_automatic_notes(r.research),'catalog_evidence',coalesce(ce.records,'[]'::jsonb),
  'visual_proposal',case when fresh.valid then v.evidence else null end,
  'proposal_revision',v.based_on_revision,'proposal_current',coalesce(fresh.valid,false),
  'photo_selection',s.selection,'exports_verified',s.exports_verified,
  'media_health',studio_core.media_health(i.id),
  'field_sources',(select coalesce(jsonb_object_agg(fp.field_name,fp.source),'{}'::jsonb) from studio_core.field_provenance fp where fp.inventory_id=i.id)
 ) order by i.id),'[]'::jsonb)
 from studio_core.inventory i join studio_core.listing_authoring a on a.inventory_id=i.id
 left join studio_core.generated_copy g on g.inventory_id=i.id
 left join studio_core.product_identity p on p.inventory_id=i.id
 left join studio_core.research_evidence r on r.inventory_id=i.id
 left join lateral (select jsonb_agg(jsonb_build_object('id',e.id,'source_kind',e.source_kind,'url',e.url,
  'product_name',e.product_name,'brand',e.brand,'model',e.model,'evidence',e.evidence,
  'based_on_listing_revision',e.based_on_listing_revision,'based_on_identity_revision',e.based_on_identity_revision,
  'recorded_at',e.recorded_at) order by e.id desc) records from studio_core.catalog_evidence e where e.inventory_id=i.id) ce on true
 left join lateral (select evidence,based_on_revision from studio_core.field_proposals
  where inventory_id=i.id and source='cloud_visual_research' order by id desc limit 1) v on true
 left join studio_core.photo_selection s on s.inventory_id=i.id
 left join lateral (select coalesce(jsonb_agg(t.sha256 order by t.ord),'[]'::jsonb) hashes from (
  select asset.sha256,x.ord from jsonb_array_elements(s.selection) with ordinality x(photo,ord)
  join studio_core.photo_assets asset on asset.sha256=photo->>'sha' and asset.cloud_verified_at is not null
  where photo->>'kind'='real' and asset.bytes<=16000000 order by x.ord limit 2) t) photos on true
 left join lateral (select v.based_on_revision=a.revision and photos.hashes<>'[]'::jsonb
  and v.evidence->'photo_hashes'=photos.hashes as valid) fresh on true);
end $function$;

revoke all on function studio_core.copy_rules() from public,anon,authenticated;
revoke all on function studio_core.machine_fragment(text) from public,anon,authenticated;
revoke all on function studio_core.machine_text(text,text) from public,anon,authenticated;
revoke all on function studio_core.clean_copy(text) from public,anon,authenticated;
revoke all on function studio_core.machine_fields(jsonb) from public,anon,authenticated;
revoke all on function studio_core.without_automatic_notes(jsonb) from public,anon,authenticated;
revoke all on function studio_core.enforce_generated_copy() from public,anon,authenticated;
revoke all on function studio_core.enforce_manual_notes() from public,anon,authenticated;
revoke all on function studio_core.enforce_research_notes() from public,anon,authenticated;
