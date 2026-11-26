-- Run only if Vercel still serves the exact manual-handoff deployment below.
begin;
do $$
declare previous studio_core.release_manifest;
begin
  select * into previous from studio_core.release_manifest where active for update;
  if previous.git_sha='2bd4c19d1401d638435f5ac65dc32546bf336c2c'
    and previous.vercel_deployment_id='dpl_7BSUfzqJzDxHskZAc75Bwx6qeBKf' then return; end if;
  if previous.git_sha is distinct from '54a13197d41003bbb1ef1a5108f888002b75178a'
    or previous.vercel_deployment_id is distinct from 'dpl_FpSCeky35pAuoe8AgX4D8MYxakVQ'
    then raise exception 'Active Studio release changed; recheck Vercel before reconciling'; end if;
  update studio_core.release_manifest set active=false where id=previous.id;
  insert into studio_core.release_manifest
    (release_name,git_sha,vercel_deployment_id,migration_head,companion_version,companion_sha256,policy_version,manifest,active)
    values ('studio-mercari-manual-20261125.1','2bd4c19d1401d638435f5ac65dc32546bf336c2c','dpl_7BSUfzqJzDxHskZAc75Bwx6qeBKf',
      previous.migration_head,previous.companion_version,previous.companion_sha256,previous.policy_version,
      previous.manifest||jsonb_build_object('branch','fix/mercari-manual-handoff','previous_deployment_id',previous.vercel_deployment_id),true);
end $$;
commit;
