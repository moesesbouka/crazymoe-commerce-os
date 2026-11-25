begin;

-- Private implementation functions are callable only through owner-checking
-- public wrappers. Revoke PostgreSQL's inherited PUBLIC execute grant.
revoke all on function studio_core.mercari_confirm_available(text, text, text) from public, anon;
revoke all on function studio_core.mercari_links(text, uuid, text, bigint, jsonb) from public, anon;
revoke all on function studio_core.record_client_event(jsonb) from public, anon;
grant execute on function studio_core.mercari_confirm_available(text, text, text) to authenticated;
grant execute on function studio_core.mercari_links(text, uuid, text, bigint, jsonb) to authenticated;
grant execute on function studio_core.record_client_event(jsonb) to authenticated;

-- The custom-token worker now enters through the rate-limitable Edge Function.
-- Only its service-role request may reach the SECURITY DEFINER RPC directly.
revoke all on function public.studio_mercari_research_work(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.studio_mercari_research_work(text, text, uuid, uuid, jsonb) to service_role;

commit;
