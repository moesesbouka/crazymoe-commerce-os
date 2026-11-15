-- Bind the tested production artifacts. The migration head below is the
-- behavior-changing correctness migration; this statement only records it.
update studio_core.release_manifest set active=false where active;

insert into studio_core.release_manifest(
  release_name,git_sha,vercel_deployment_id,migration_head,
  companion_version,companion_sha256,policy_version,manifest,active
) values (
  'stabilize-20261115.1',
  'c563744482579331faa2e4c46e94b9c3391f1d6d',
  'dpl_9hc9NKh2r85f9TnTCVrpqWtj8vCz',
  '20261115060329',
  '2.4.0',
  '161d8d34507daffbc56c63b44d17d71842d87a13a635ec001f4b7e5395ec8a2c',
  'mercari-2026-11-15.1',
  jsonb_build_object(
    'previous_deployment_id','dpl_8H62opECqeRoeSWfvUTYPPToMaoT',
    'tested_preview_id','dpl_7TSPyVbBg1zQ1EfgX83pF8px2BKr',
    'promotion_method','immutable redeploy of tested preview',
    'branch','stabilize-20261115'
  ),
  true
)
on conflict(release_name) do update set
 git_sha=excluded.git_sha,
 vercel_deployment_id=excluded.vercel_deployment_id,
 migration_head=excluded.migration_head,
 companion_version=excluded.companion_version,
 companion_sha256=excluded.companion_sha256,
 policy_version=excluded.policy_version,
 manifest=excluded.manifest,
 active=true;
