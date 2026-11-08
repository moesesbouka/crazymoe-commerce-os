-- Fix mutable search paths and remove anonymous access to the privileged
-- queue rebuild helper without changing the still-live legacy table grants.
alter function public.update_updated_at() set search_path = public, pg_temp;
alter function public.cmoe_touch_active_listing() set search_path = public, pg_temp;
alter function public.cmoe_effective_status(text, text) set search_path = public, pg_temp;
alter function public.run_cmoe_detector(text) set search_path = public, pg_temp;

revoke execute on function public.cmoe_rebuild_action_queue(text) from public, anon;
grant execute on function public.cmoe_rebuild_action_queue(text) to authenticated, service_role;
