-- Schema lookup permission only. Posting tables remain denied to service_role;
-- only the explicitly granted transfer implementation can access them.
grant usage on schema studio_core to service_role;
