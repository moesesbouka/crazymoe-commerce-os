alter table inventory_items enable row level security;
alter table posting_sessions enable row level security;
alter table posting_results enable row level security;
alter table crm_threads enable row level security;
alter table review_requests enable row level security;

drop policy if exists inventory_items_read on inventory_items;
create policy inventory_items_read on inventory_items for select to authenticated, anon using (true);

drop policy if exists posting_sessions_read on posting_sessions;
create policy posting_sessions_read on posting_sessions for select to authenticated, anon using (true);

drop policy if exists posting_results_read on posting_results;
create policy posting_results_read on posting_results for select to authenticated, anon using (true);

drop policy if exists crm_threads_read on crm_threads;
create policy crm_threads_read on crm_threads for select to authenticated, anon using (true);

drop policy if exists inventory_items_write on inventory_items;
create policy inventory_items_write on inventory_items for all to authenticated using (true) with check (true);

drop policy if exists posting_sessions_write on posting_sessions;
create policy posting_sessions_write on posting_sessions for all to authenticated using (true) with check (true);

drop policy if exists posting_results_write on posting_results;
create policy posting_results_write on posting_results for all to authenticated using (true) with check (true);

drop policy if exists crm_threads_write on crm_threads;
create policy crm_threads_write on crm_threads for all to authenticated using (true) with check (true);

drop policy if exists review_requests_write on review_requests;
create policy review_requests_write on review_requests for all to authenticated using (true) with check (true);

-- Prefer an edge function or authenticated poster user over anonymous write access.