-- Independent source records describe a catalog product, not the physical item.
create table studio_core.catalog_sources (
 brand text not null, model text not null,
 source_kind text not null check (source_kind in ('manufacturer','retailer')),
 url text not null check (url ~ '^https://[^/]+/'),
 product_name text not null,
 checked_at timestamptz not null default now(),
 primary key(brand,model,url)
);
alter table studio_core.catalog_sources enable row level security;
alter table studio_core.catalog_sources force row level security;
revoke all on studio_core.catalog_sources from public,anon,authenticated,service_role;

create function studio_core.gtin_key(code text) returns text
language sql immutable strict set search_path='' as $$
 select case when length(code) in (8,12,13,14) and code ~ '^[0-9]+$' then
 (select case when sum(substr(code,i,1)::integer * (case when (length(code)-i)%2=1 then 3 else 1 end))%10=0 then lpad(code,14,'0') end
 from generate_series(1,length(code)) i) end;
$$;
revoke all on function studio_core.gtin_key(text) from public,anon,authenticated,service_role;

create function studio_core.corroborate_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare barcode text; catalog jsonb; matches jsonb; sources jsonb; refs jsonb;
 visual_model text; catalog_model text; signal text; lines jsonb; needs jsonb;
begin
 if new.source<>'cloud_visual_research' then return new; end if;
 select studio_core.gtin_key(p.identity->>'barcode'), r.research->'catalog_match' into barcode,catalog
 from studio_core.product_identity p left join studio_core.research_evidence r using(inventory_id)
 where p.inventory_id=new.inventory_id;
 select coalesce(jsonb_agg(jsonb_build_object('file',m.source_key,'row',r->'row','upc',r->'upc','candidate',r->'candidate_identity','brand',r->'brand') order by m.source_key,r->>'row'),'[]')
 into matches from studio_core.manifest_evidence m cross join lateral jsonb_array_elements(case when jsonb_typeof(m.evidence->'rows')='array' then m.evidence->'rows' else '[]' end) r
 where barcode=studio_core.gtin_key(r->>'upc');
 catalog_model:=nullif(trim(catalog->>'model'),'');
 visual_model:=nullif(trim(new.fields->>'model'),'');
 select coalesce(jsonb_agg(to_jsonb(c) order by c.source_kind,c.url),'[]') into sources from studio_core.catalog_sources c
 where upper(c.model)=upper(catalog_model) and upper(c.brand)=upper(trim(catalog->>'brand'));
 select coalesce(jsonb_agg(jsonb_build_object('id',reference_id,'sha256',sha256,'url',source_metadata->>'source_url') order by reference_id),'[]')
 into refs from studio_core.reference_assets where inventory_id=new.inventory_id and cloud_verified_at is not null;
 signal:=case when catalog_model is null or visual_model is null then 'incomplete'
 when upper(visual_model)<>upper(catalog_model) then 'conflict'
 when new.evidence->>'confidence'='exact_label' then 'label_matches_catalog' else 'unconfirmed' end;
 lines:=coalesce(new.evidence->'observations','[]');
 if catalog_model is not null then lines:=lines||jsonb_build_array('Catalog candidate: '||concat_ws(' ',catalog->>'brand',catalog_model));end if;
 if jsonb_array_length(matches)>0 then lines:=lines||jsonb_build_array('Matching purchase manifest UPC: '||(matches->0->>'upc')||' · '||(matches->0->>'candidate'));end if;
 if jsonb_array_length(sources)>0 then lines:=lines||(select jsonb_agg(to_jsonb((s->>'source_kind')||' reference: '||(s->>'url'))) from jsonb_array_elements(sources)s);end if;
 new.evidence:=new.evidence||jsonb_build_object('visual_candidate',new.fields,'visual_confidence',new.evidence->'confidence','catalog_comparison',signal,'catalog_candidate',catalog,'manifest_matches',matches,'catalog_sources',sources,'reference_images',refs,'observations',lines);
 if exists(select 1 from jsonb_array_elements(matches) m where nullif(trim(m->>'brand'),'') is not null and upper(trim(m->>'brand'))<>upper(trim(catalog->>'brand'))) or (select count(distinct upper(trim(m->>'candidate'))) from jsonb_array_elements(matches) m)>1 then
  signal:='conflict';
  new.evidence:=new.evidence||jsonb_build_object('catalog_comparison',signal);
 end if;
 if signal='conflict' or new.evidence->>'confidence'<>'exact_label' or visual_model is null then
  needs:=case when jsonb_typeof(new.evidence->'needs_seller_input')='array' then new.evidence->'needs_seller_input' else '[]' end;
  new.fields:='{}';
  new.evidence:=new.evidence||jsonb_build_object('suggestion',new.fields,'confidence',case when signal='conflict' then 'conflict' else 'unconfirmed' end,
   'observations',lines||jsonb_build_array('Confirm the model on the product label before using an identification suggestion.'),
   'needs_seller_input',needs||jsonb_build_array('Confirm product label'));
 end if;
 return new;
end $$;
revoke all on function studio_core.corroborate_identity() from public,anon,authenticated,service_role;
create trigger corroborate_identity before insert on studio_core.field_proposals
for each row execute function studio_core.corroborate_identity();
