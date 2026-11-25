-- Studio clients use existing membership-checked functions for these tables.
-- Keep direct client access denied. With RLS enabled and no policies, ordinary
-- roles remain denied even if a table grant is added later. The postgres-owned
-- functions and release migrations retain their existing owner access.
set local lock_timeout = '3s';

revoke all on table
  studio_core.mercari_condition_map,
  studio_core.mercari_availability_overrides,
  studio_core.physical_links,
  studio_core.release_manifest,
  studio_core.client_events,
  studio_core.channel_publication_evidence
from public, anon, authenticated;

alter table studio_core.mercari_condition_map enable row level security;
alter table studio_core.mercari_availability_overrides enable row level security;
alter table studio_core.physical_links enable row level security;
alter table studio_core.release_manifest enable row level security;
alter table studio_core.client_events enable row level security;
alter table studio_core.channel_publication_evidence enable row level security;
