begin;

create or replace function public.studio_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if auth.uid() is null or not studio_core.is_member() then
    raise exception 'Studio access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'checked_at', now(),
    'release', coalesce((
      select to_jsonb(r) - 'id' - 'manifest'
      from studio_core.release_manifest r
      where r.active
      order by r.created_at desc
      limit 1
    ), '{}'::jsonb),
    'worker', coalesce((
      select jsonb_build_object(
        'label', w.label,
        'last_seen_at', w.last_seen_at,
        'connected', w.last_seen_at > now() - interval '2 minutes'
      )
      from studio_core.mercari_research_workers w
      where w.owner_id = auth.uid()
      order by w.last_seen_at desc
      limit 1
    ), jsonb_build_object('connected', false)),
    'inventory', jsonb_build_object(
      'last_observed_at', (select max(o.observed_at) from studio_core.facebook_observations o),
      'queue_open', (select count(*) from studio_core.mercari_queue q where q.owner_id = auth.uid() and q.state in ('needs_details','ready','handed_off')),
      'queue_ready', (select count(*) from studio_core.mercari_queue q where q.owner_id = auth.uid() and q.state = 'ready'),
      'source_unavailable', (select count(*) from studio_core.mercari_queue q where q.owner_id = auth.uid() and q.state = 'source_unavailable'),
      'duplicate_candidates', (select count(*) from studio_core.physical_links l where l.owner_id = auth.uid() and l.status = 'candidate')
    ),
    'telemetry', jsonb_build_object(
      'errors_24h', (select count(*) from studio_core.client_events e where e.owner_id = auth.uid() and e.created_at > now() - interval '24 hours' and e.result_code not in ('OK','SUCCESS','FILLED','PUBLISHED')),
      'last_event_at', (select max(e.created_at) from studio_core.client_events e where e.owner_id = auth.uid())
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.studio_health() from public, anon;
grant execute on function public.studio_health() to authenticated;

commit;
