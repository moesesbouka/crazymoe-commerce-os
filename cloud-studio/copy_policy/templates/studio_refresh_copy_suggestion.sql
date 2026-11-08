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
 values(p_item,jsonb_build_object('description',result->>'description'),p_revision,'owner_requested_copy_cleanup',jsonb_build_object('original_description',original,'internal_notes',result->>'internal_notes','method','deterministic-cleanup-v1'));
 insert into studio_core.generated_copy(inventory_id,fields,source,based_on_revision)
 values(p_item,coalesce(candidate.fields,'{}'::jsonb)||jsonb_build_object('description',result->>'description'),'owner_requested_copy_cleanup',p_revision)
 on conflict(inventory_id) do update set fields=excluded.fields,source=excluded.source,based_on_revision=excluded.based_on_revision,created_at=now();
 return jsonb_build_object('description',result->>'description','based_on_revision',p_revision);
end $function$
