-- Preserve original source URLs; bind each derived photo to its source bytes and rendering version.
create or replace function studio_core.studio_posting_prepare(p_account uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; src public.active_listings; dest studio_core.posting_accounts; prior studio_core.posting_copies;
 copy_id uuid; draft jsonb; photo text; manifest jsonb; entry jsonb; idx integer; results jsonb:='[]';
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501'; end if;
 select * into dest from studio_core.posting_accounts where id=p_account and owner_id=auth.uid();
 if dest.id is null then raise exception 'Choose your destination account'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 or octet_length(p_rows::text)>2000000
 then raise exception 'Choose between 1 and 50 products per batch'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by (value->>'source_id')::bigint loop
  select * into src from public.active_listings where id=(r->>'source_id')::bigint for share;
  if src.id is null or src.is_active is not true or src.status is distinct from 'active' or coalesce(src.quantity,1)<=0
  then raise exception 'A selected product is no longer available'; end if;
  if src.account_tag=dest.account_tag then raise exception 'Source and destination must differ'; end if;
  if studio_core.posting_digest(src) is distinct from r->>'digest' then raise exception 'Product changed; refresh before preparing' using errcode='40001'; end if;
  if nullif(trim(src.description),'') is null or nullif(trim(src.condition),'') is null or src.price is null or src.price<0
  then raise exception 'Source description, condition, or price is missing'; end if;
  draft:=r->'draft';
  if jsonb_typeof(draft) is distinct from 'object' or length(trim(coalesce(draft->>'title',''))) not between 1 and 150
   or length(trim(coalesce(draft->>'description',''))) not between 1 and 20000
   or jsonb_typeof(draft->'images') is distinct from 'array' or jsonb_array_length(draft->'images') not between 1 and 10
  then raise exception 'Check title, description, and one to ten photos'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(draft->'images'))<>jsonb_array_length(draft->'images') then raise exception 'Repeated photo'; end if;
  for photo in select value from jsonb_array_elements_text(draft->'images') loop
   if not (photo=any(coalesce(src.images,array[]::text[]))) or photo !~ '^https://sfheqjnxlkygjfohoybo\.supabase\.co/storage/v1/object/public/listing-images/'
   then raise exception 'Use an archived public photo from this product'; end if;
  end loop;
  manifest:='[]'::jsonb;
  if draft ? 'photo_style' then
   if draft->>'photo_style' is distinct from 'alt-frame-v1' or jsonb_typeof(draft->'photo_manifest') is distinct from 'array'
     or jsonb_array_length(draft->'photo_manifest') is distinct from jsonb_array_length(draft->'images')
   then raise exception 'Prepare every photo before saving this batch'; end if;
   for idx in 0..jsonb_array_length(draft->'images')-1 loop
    entry:=draft->'photo_manifest'->idx;
    if jsonb_typeof(entry) is distinct from 'object' or entry->>'url' is distinct from draft->'images'->>idx
      or coalesce(entry->>'source_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(entry->>'width','') !~ '^[0-9]{1,4}$' or coalesce(entry->>'height','') !~ '^[0-9]{1,4}$'
    then raise exception 'Photo preparation is incomplete or in the wrong order'; end if;
    if (entry->>'width')::integer not between 1 and 1600 or (entry->>'height')::integer not between 1 and 1600
    then raise exception 'Prepared photo dimensions are invalid'; end if;
    manifest:=manifest||jsonb_build_array(jsonb_build_object('url',entry->>'url','source_sha256',entry->>'source_sha256','width',(entry->>'width')::integer,'height',(entry->>'height')::integer));
   end loop;
  end if;
  draft:=jsonb_build_object('title',trim(draft->>'title'),'description',trim(draft->>'description'),
   'price',src.price,'condition',src.condition,'category',src.category,'images',draft->'images') || case when draft ? 'photo_style' then jsonb_build_object('photo_style','alt-frame-v1','photo_manifest',manifest) else '{}'::jsonb end;
  select * into prior from studio_core.posting_copies where owner_id=auth.uid() and source_id=src.id and account_id=dest.id for update;
  if prior.id is not null and prior.state not in ('prepared','error','stale','cancelled') then
   raise exception 'This product already has a draft or listing on the destination';
  end if;
  insert into studio_core.posting_copies(owner_id,source_id,account_id,source_digest,draft)
  values(auth.uid(),src.id,dest.id,r->>'digest',draft)
  on conflict(owner_id,source_id,account_id) do update set draft=excluded.draft,source_digest=excluded.source_digest,
   state='prepared',revision=posting_copies.revision+1,issue=null,transfer_hash=null,transfer_expires=null,updated_at=now()
  where posting_copies.state in ('prepared','error','stale','cancelled')
  returning id into copy_id;
  if copy_id is null then raise exception 'Destination workflow changed; refresh before preparing' using errcode='40001'; end if;
  insert into studio_core.posting_events(copy_id,state) values(copy_id,'prepared');
  results:=results||jsonb_build_array(copy_id);
 end loop;
 return results;
end $$;

create or replace function studio_core.studio_posting_transfer(p_token text,p_action text,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c studio_core.posting_copies; s public.active_listings; a studio_core.posting_accounts; entry jsonb; expected jsonb; idx integer;
begin
 if jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>20000 then raise exception 'Invalid photo evidence'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transfer'; end if;
 select * into c from studio_core.posting_copies where transfer_hash=encode(extensions.digest(p_token,'sha256'),'hex') and transfer_expires>now() for update;
 if c.id is null or c.state<>'filling' or not exists(select 1 from studio_core.members where user_id=c.owner_id and enabled)
 then raise exception 'Transfer expired or already completed'; end if;
 select * into s from public.active_listings where id=c.source_id for share;
 if s.is_active is not true or s.status is distinct from 'active' or coalesce(s.quantity,1)<=0 or studio_core.posting_digest(s)<>c.source_digest
 then raise exception 'Product changed or sold'; end if;
 select * into a from studio_core.posting_accounts where id=c.account_id;
 if p_action='read' then return jsonb_build_object('id',c.id,'revision',c.revision,'source_id',c.source_id,'item',c.draft,'profile_id',a.profile_id,'account_label',a.label); end if;
 if p_action='filled' then
  if p_evidence->>'profile_id' is distinct from a.profile_id or (p_evidence->>'photo_count')::integer is distinct from jsonb_array_length(c.draft->'images')
  then raise exception 'Account or photo verification failed'; end if;
  if c.draft ? 'photo_style' then
   if p_evidence->>'photo_style' is distinct from c.draft->>'photo_style'
    or jsonb_typeof(p_evidence->'photo_manifest') is distinct from 'array'
    or jsonb_array_length(p_evidence->'photo_manifest') is distinct from jsonb_array_length(c.draft->'images')
   then raise exception 'Prepared photo verification failed; reload the updated extension'; end if;
   for idx in 0..jsonb_array_length(c.draft->'images')-1 loop
    entry:=p_evidence->'photo_manifest'->idx;expected:=c.draft->'photo_manifest'->idx;
    if (entry-'output_sha256') is distinct from expected or coalesce(entry->>'output_sha256','') !~ '^[a-f0-9]{64}$'
    then raise exception 'Uploaded photos do not match the prepared batch'; end if;
   end loop;
  end if;
 elsif p_action<>'error' then raise exception 'Invalid transfer action'; end if;
 update studio_core.posting_copies set state=p_action,issue=case when p_action='error' then left(p_evidence->>'error',500) else null end,
  transfer_hash=null,transfer_expires=null,updated_at=now() where id=c.id;
 insert into studio_core.posting_events(copy_id,state,evidence) values(c.id,p_action,p_evidence-'token');
 return jsonb_build_object('ok',true);
end $$;
