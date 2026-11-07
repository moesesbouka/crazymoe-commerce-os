-- Keep privileged implementations private; expose only invoker wrappers.

alter function public.studio_posting_accounts(text,text,text) set schema studio_core;
create function public.studio_posting_accounts(p_label text default null,p_profile text default null,p_tag text default null) returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_accounts(p_label,p_profile,p_tag) $$;
revoke all on function public.studio_posting_accounts(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_accounts(text,text,text) to authenticated;

alter function public.studio_posting_inventory(text,integer,integer) set schema studio_core;
create function public.studio_posting_inventory(p_query text default '',p_offset integer default 0,p_limit integer default 100) returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_inventory(p_query,p_offset,p_limit) $$;
revoke all on function public.studio_posting_inventory(text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_inventory(text,integer,integer) to authenticated;

alter function public.studio_posting_prepare(uuid,jsonb) set schema studio_core;
create function public.studio_posting_prepare(p_account uuid,p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_prepare(p_account,p_rows) $$;
revoke all on function public.studio_posting_prepare(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_prepare(uuid,jsonb) to authenticated;

alter function public.studio_posting_queue() set schema studio_core;
create function public.studio_posting_queue() returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_queue() $$;
revoke all on function public.studio_posting_queue() from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_queue() to authenticated;

alter function public.studio_posting_claim(uuid,integer) set schema studio_core;
create function public.studio_posting_claim(p_id uuid,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_claim(p_id,p_revision) $$;
revoke all on function public.studio_posting_claim(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_claim(uuid,integer) to authenticated;

alter function public.studio_posting_result(uuid,integer,text,text) set schema studio_core;
create function public.studio_posting_result(p_id uuid,p_revision integer,p_action text,p_url text default null) returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_result(p_id,p_revision,p_action,p_url) $$;
revoke all on function public.studio_posting_result(uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_result(uuid,integer,text,text) to authenticated;

alter function public.studio_posting_transfer(text,text,jsonb) set schema studio_core;
create function public.studio_posting_transfer(p_token text,p_action text,p_evidence jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select studio_core.studio_posting_transfer(p_token,p_action,p_evidence) $$;
revoke all on function public.studio_posting_transfer(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.studio_posting_transfer(text,text,jsonb) to service_role;
