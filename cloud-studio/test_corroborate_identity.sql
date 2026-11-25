begin;
do $$
declare item text; model text; proposal jsonb; candidate jsonb; prior jsonb; stamp bigint; record_row studio_core.field_proposals; manifest_item text;
begin
 if studio_core.gtin_key('041093913693') is distinct from studio_core.gtin_key('0041093913693')
 or studio_core.gtin_key('041093913692') is not null or studio_core.gtin_key('bogus') is not null then raise exception 'GTIN validation failed';end if;
 select r.inventory_id,r.research->'catalog_match'->>'model',a.fields,a.revision into strict item,model,prior,stamp
 from studio_core.research_evidence r join studio_core.listing_authoring a using(inventory_id)
 where r.research->'catalog_match'->>'model'<>'' limit 1;
 proposal:=jsonb_build_object('confidence','exact_label','observations','[]'::jsonb);
 candidate:=jsonb_build_object('model','deliberate-conflict','title','blocked');
 insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence) values(item,candidate,stamp,'cloud_visual_research',proposal) returning * into record_row;
 if record_row.fields<>'{}' or record_row.evidence->>'catalog_comparison'<>'conflict' or record_row.evidence->'visual_candidate'<>candidate then raise exception 'Unsafe conflicting proposal';end if;
 candidate:=jsonb_build_object('model',model);
 insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence) values(item,candidate,stamp,'cloud_visual_research',proposal||'{"confidence":"partial"}') returning * into record_row;
 if record_row.fields<>'{}' then raise exception 'Partial model offered';end if;
 select p.inventory_id into strict manifest_item from studio_core.product_identity p cross join studio_core.manifest_evidence m
 cross join lateral jsonb_array_elements(m.evidence->'rows') r where studio_core.gtin_key(p.identity->>'barcode')=studio_core.gtin_key(r->>'upc') limit 1;
 insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence) values(manifest_item,'{}',1,'cloud_visual_research',proposal) returning * into record_row;
 if jsonb_array_length(record_row.evidence->'manifest_matches')<1 then raise exception 'Manifest missing';end if;
 if prior is distinct from (select fields from studio_core.listing_authoring where inventory_id=item) then raise exception 'Seller fields changed';end if;
end $$;
rollback;
