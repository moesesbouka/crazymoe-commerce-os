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
