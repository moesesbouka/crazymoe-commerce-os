create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if not exists(select 1 from vault.secrets where name='studio_worker_token') then
  perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'studio_worker_token');
 end if;
end $$;
create function public.studio_worker_claim(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job studio_core.jobs; result jsonb;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501'; end if;
 update studio_core.jobs set state='failed',last_error='Final worker lease expired'
 where kind='identify' and state='running' and attempts>=3 and lease_until<=now();
 with next_job as (
 select id from studio_core.jobs where kind='identify' and attempts<3
 and ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now()))
 order by available_at,created_at for update skip locked limit 1)
 update studio_core.jobs j set state='running',attempts=j.attempts+1,lease_until=now()+interval '4 minutes'
 from next_job where j.id=next_job.id returning j.* into job;
 if job.id is null then return null; end if;
 select jsonb_build_object('id',job.id,'attempt',job.attempts,'revision',a.revision,
 'photos',coalesce((select jsonb_agg(to_jsonb(t)) from (
 select asset.bucket,asset.object_path,asset.sha256,asset.bytes
 from jsonb_array_elements(s.selection) with ordinality as x(photo,ord)
 join studio_core.photo_assets asset on asset.sha256=photo->>'sha' and asset.cloud_verified_at is not null
 where photo->>'kind'='real' and asset.bytes<=16000000 order by ord limit 2) t),'[]'::jsonb))
 into result from studio_core.listing_authoring a join studio_core.photo_selection s using(inventory_id)
 where a.inventory_id=job.inventory_id;
 return result;
end $$;
create function public.studio_worker_finish(p_job uuid,p_attempt int,p_revision bigint,p_evidence jsonb,p_failure text)
returns void language plpgsql security definer set search_path='' as $$
declare job studio_core.jobs;
begin
 select * into strict job from studio_core.jobs where id=p_job for update;
 if job.state<>'running' or job.attempts<>p_attempt or job.lease_until<now() then raise exception 'Worker lease expired'; end if;
 if p_failure is not null then
  update studio_core.jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
   last_error=left(p_failure,250),available_at=now()+interval '5 minutes',lease_until=null where id=p_job;
 else
  insert into studio_core.field_proposals(inventory_id,fields,based_on_revision,source,evidence)
  values(job.inventory_id,coalesce(p_evidence->'suggestion','{}'),p_revision,'cloud_visual_research',p_evidence);
  update studio_core.jobs set state='succeeded',lease_until=null,last_error=null where id=p_job;
 end if;
end $$;
revoke all on function public.studio_worker_claim(text),public.studio_worker_finish(uuid,int,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_worker_claim(text),public.studio_worker_finish(uuid,int,bigint,jsonb,text) to service_role;
-- Reuse the private durable job queue; never replace a verified historical export.
create function public.studio_request_render(p_item text,p_revision bigint,p_photo_revision bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare a studio_core.listing_authoring; s studio_core.photo_selection; job_id uuid;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item for update;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item for update;
 if a.revision<>p_revision or s.revision<>p_photo_revision then raise exception 'Selection changed' using errcode='40001';end if;
 if a.status<>'review' or not exists(select 1 from studio_core.inventory where id=p_item and lifecycle='current')
 or s.exports_verified or exists(select 1 from studio_core.export_sets where inventory_id=p_item)
 then raise exception 'Use the existing export or current review product';end if;
 if jsonb_array_length(s.selection) not between 1 and 10 then raise exception 'Select one to ten photos';end if;
 -- First production renderer scope: verified inventory originals. Manufacturer and focus rules need their own evidence.
 if exists(select 1 from jsonb_array_elements(s.selection) p left join studio_core.photo_assets f on f.sha256=p->>'sha'
 where p->>'kind' is distinct from 'real' or f.cloud_verified_at is null or f.bytes>16000000
 or coalesce(p->>'style_mode','natural') not in ('natural','blur','brand')) then raise exception 'Unverified render source';end if;
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload)
 values(p_item,'render',p_item||':render:'||p_revision||':'||p_photo_revision,
 jsonb_build_object('listing_revision',p_revision,'photo_revision',p_photo_revision,'selection',s.selection,'requested_by',auth.uid(),'recipe','existing-finish-v4-pop-v1-cloud1'))
 on conflict(idempotency_key) do nothing returning id into job_id;
 if job_id is null then select id into strict job_id from studio_core.jobs where idempotency_key=p_item||':render:'||p_revision||':'||p_photo_revision;end if;
 return job_id;
end $$;

create function public.studio_render_claim(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j studio_core.jobs;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501';end if;
 update studio_core.jobs set state='failed',last_error='Final render lease expired',lease_until=null
 where kind='render' and state='running' and attempts>=3 and lease_until<=now();
 with candidate as (select id from studio_core.jobs where kind='render' and attempts<3
 and ((state='queued' and available_at<=now()) or (state='running' and lease_until<=now()))
 order by available_at,created_at for update skip locked limit 1)
 update studio_core.jobs q set state='running',attempts=q.attempts+1,lease_until=now()+interval '5 minutes'
 from candidate where q.id=candidate.id returning q.* into j;
 if j.id is null then return null;end if;
 return jsonb_build_object('id',j.id,'attempt',j.attempts,'inventory_id',j.inventory_id,'snapshot',j.payload);
end $$;

create function public.studio_render_finish(p_job uuid,p_attempt int,p_images jsonb,p_failure text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j studio_core.jobs; a studio_core.listing_authoring; s studio_core.photo_selection;
begin
 -- Match editor lock order before acquiring the job lock to avoid deadlocks.
 select * into strict j from studio_core.jobs where id=p_job and kind='render';
 select * into strict a from studio_core.listing_authoring where inventory_id=j.inventory_id for update;
 select * into strict s from studio_core.photo_selection where inventory_id=j.inventory_id for update;
 select * into strict j from studio_core.jobs where id=p_job for update;
 if j.state<>'running' or j.attempts<>p_attempt or j.lease_until is null or j.lease_until<=now() then raise exception 'Render lease expired';end if;
 if a.revision<>(j.payload->>'listing_revision')::bigint or s.revision<>(j.payload->>'photo_revision')::bigint
 or s.selection is distinct from j.payload->'selection' or s.exports_verified or a.status<>'review'
 or not exists(select 1 from studio_core.inventory where id=j.inventory_id and lifecycle='current')
 or exists(select 1 from studio_core.export_sets where inventory_id=j.inventory_id) then
 update studio_core.jobs set state='failed',last_error='Render snapshot changed',lease_until=null where id=j.id;return false;end if;
 if p_failure is not null then
 update studio_core.jobs set state=case when attempts>=3 then 'failed' else 'queued' end,
 last_error=left(p_failure,200),available_at=now()+interval '5 minutes',lease_until=null where id=j.id;return false;end if;
 if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images)<>jsonb_array_length(s.selection)
 then raise exception 'Incomplete render set';end if;
 -- Trusted worker must upload, download and hash each JPEG before this call.
 if exists(select 1 from jsonb_array_elements(p_images) with ordinality x(i,ord)
 left join storage.objects o on o.bucket_id='studio-originals' and o.name='exports/'||(i->>'sha')
 where coalesce(i->>'sha','') !~ '^[0-9a-f]{64}$' or coalesce((i->>'bytes')::bigint,0) not between 1 and 4000000
 or (o.metadata->>'size')::bigint is distinct from (i->>'bytes')::bigint
 or i->>'width' is distinct from '1600' or i->>'height' is distinct from '1600'
 or i->>'source_sha' is distinct from s.selection->(ord::int-1)->>'sha'
 or i->>'recipe' is distinct from j.payload->>'recipe') then raise exception 'Render receipt mismatch';end if;
 insert into studio_core.export_sets(inventory_id,selection,images) values(j.inventory_id,s.selection,p_images);
 insert into studio_core.photo_choices(inventory_id,position,choice,source,image)
 select j.inventory_id,ord,i->>'sha',s.selection->(ord::int-1),i from jsonb_array_elements(p_images) with ordinality x(i,ord);
 update studio_core.photo_selection set exports_verified=true where inventory_id=j.inventory_id;
 update studio_core.jobs set state='succeeded',last_error=null,lease_until=null where id=j.id;
 return true;
end $$;
revoke all on function public.studio_request_render(text,bigint,bigint),public.studio_render_claim(text),public.studio_render_finish(uuid,int,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_request_render(text,bigint,bigint) to authenticated;
grant execute on function public.studio_render_claim(text),public.studio_render_finish(uuid,int,jsonb,text) to service_role;

-- Service-only context for a currently leased render; credentials never reach Studio.
create function public.studio_render_context(p_job uuid,p_attempt int,p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j studio_core.jobs; photos jsonb; credential text;
begin
 if p_token is null or not exists(select 1 from vault.decrypted_secrets where name='studio_worker_token' and decrypted_secret=p_token)
 then raise exception 'Invalid worker credential' using errcode='42501';end if;
 select * into strict j from studio_core.jobs where id=p_job and kind='render' and state='running'
 and attempts=p_attempt and lease_until>now();
 select decrypted_secret into credential from vault.decrypted_secrets where name='studio_render_secret';
 if credential is null or length(credential)<64 then raise exception 'Renderer not configured';end if;
 select jsonb_agg(jsonb_build_object('sha256',a.sha256,'bucket',a.bucket,'object_path',a.object_path,'bytes',a.bytes) order by p.ord)
 into photos from jsonb_array_elements(j.payload->'selection') with ordinality p(photo,ord)
 join studio_core.photo_assets a on a.sha256=p.photo->>'sha' and a.cloud_verified_at is not null
 and a.bucket='studio-originals' and a.bytes between 1 and 16000000 where p.photo->>'kind'='real';
 if photos is null or jsonb_array_length(photos)<>jsonb_array_length(j.payload->'selection') then raise exception 'Unverified render source';end if;
 return jsonb_build_object('photos',photos,'endpoint','https://crazymoe-marketplace-studio.vercel.app/api/process_render','secret',credential);
end $$;
revoke all on function public.studio_render_context(uuid,int,text) from public,anon,authenticated;
grant execute on function public.studio_render_context(uuid,int,text) to service_role;

-- Only verified cloud intake products receive automatic preparation.
create function studio_core.enqueue_intake_render() returns trigger
language plpgsql security definer set search_path='' as $$
declare a studio_core.listing_authoring; s studio_core.photo_selection; uploader uuid; key text;
begin
 if new.inventory_id not like 'cloud-%' then return new;end if;
 select (evidence->>'uploaded_by')::uuid into uploader from studio_core.product_identity where inventory_id=new.inventory_id;
 if uploader is null or not exists(select 1 from studio_core.members where user_id=uploader and enabled) then return new;end if;
 select * into a from studio_core.listing_authoring where inventory_id=new.inventory_id for update;
 select * into s from studio_core.photo_selection where inventory_id=new.inventory_id for update;
 if a.inventory_id is null or s.inventory_id is null or a.status<>'review' or s.exports_verified
 or not exists(select 1 from studio_core.inventory where id=new.inventory_id and lifecycle='current')
 or exists(select 1 from studio_core.export_sets where inventory_id=new.inventory_id)
 or jsonb_array_length(s.selection) not between 1 and 10 then return new;end if;
 if exists(select 1 from jsonb_array_elements(s.selection) p left join studio_core.photo_assets f on f.sha256=p->>'sha'
 where p->>'kind' is distinct from 'real' or f.cloud_verified_at is null or f.bucket<>'studio-originals'
 or f.bytes not between 1 and 16000000 or coalesce(p->>'style_mode','natural') not in ('natural','blur','brand')
 or (p ? 'pop' and jsonb_typeof(p->'pop')<>'boolean')) then return new;end if;
 key:=new.inventory_id||':render:'||a.revision||':'||s.revision;
 -- Cancel only work that has not started. Running workers still validate their snapshot at finish.
 update studio_core.jobs set state='failed',last_error='Superseded before rendering'
 where inventory_id=new.inventory_id and kind='render' and state='queued' and idempotency_key<>key;
 insert into studio_core.jobs(inventory_id,kind,idempotency_key,payload,available_at)
 values(new.inventory_id,'render',key,jsonb_build_object('listing_revision',a.revision,'photo_revision',s.revision,
 'selection',s.selection,'requested_by',uploader,'recipe','existing-finish-v4-pop-v1-cloud1'),now()+interval '10 seconds')
 on conflict(idempotency_key) do nothing;
 return new;
end $$;
revoke all on function studio_core.enqueue_intake_render() from public,anon,authenticated,service_role;
create trigger studio_intake_render after insert on studio_core.photo_selection
 for each row execute function studio_core.enqueue_intake_render();
create trigger studio_intake_render_revision after update of revision on studio_core.listing_authoring
 for each row when (old.revision is distinct from new.revision) execute function studio_core.enqueue_intake_render();

create function public.studio_render_status(p_item text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a studio_core.listing_authoring; s studio_core.photo_selection; job_state text; result text;
begin
 if not studio_core.is_member() then raise exception 'Studio access denied' using errcode='42501';end if;
 select * into strict a from studio_core.listing_authoring where inventory_id=p_item;
 select * into strict s from studio_core.photo_selection where inventory_id=p_item;
 if s.exports_verified and exists(select 1 from studio_core.export_sets where inventory_id=p_item and selection=s.selection) then result:='ready';
 else
 select state into job_state from studio_core.jobs where inventory_id=p_item and kind='render'
 and payload->>'listing_revision'=a.revision::text and payload->>'photo_revision'=s.revision::text
 order by created_at desc limit 1;
 result:=case when job_state in ('queued','running') then job_state when job_state='failed' then 'failed'
 when jsonb_array_length(s.selection)=0 then 'needs_photos'
 when jsonb_array_length(s.selection)>10 then 'selection_limit' else 'not_prepared' end;
 end if;
 return jsonb_build_object('state',result,'revision',a.revision,'photo_revision',s.revision);
end $$;
revoke all on function public.studio_render_status(text) from public,anon,authenticated,service_role;
grant execute on function public.studio_render_status(text) to authenticated;
