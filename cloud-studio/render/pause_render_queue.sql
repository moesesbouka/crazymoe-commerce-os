-- Reversible pause. Retain all job/evidence records and existing exports.
revoke execute on function public.studio_request_render(text,bigint,bigint) from authenticated;
revoke execute on function public.studio_render_claim(text),public.studio_render_finish(uuid,int,jsonb,text) from service_role;
-- Resume only after verifying the deployed worker version:
-- grant execute on function public.studio_request_render(text,bigint,bigint) to authenticated;
-- grant execute on function public.studio_render_claim(text),public.studio_render_finish(uuid,int,jsonb,text) to service_role;
