create extension if not exists "pgcrypto";

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text,
  model text,
  upc text,
  title text not null default '',
  description text default '',
  condition text default 'Good',
  price numeric(10,2),
  category text,
  source_url text,
  source_name text,
  image_manifest jsonb default '[]'::jsonb,
  status text not null default 'draft',
  found_at timestamptz,
  ready_at timestamptz,
  posted_at timestamptz,
  listed_at timestamptz,
  sold_at timestamptz,
  optimized_title text,
  optimized_description text,
  optimized_price numeric(10,2),
  optimization_status text default 'none',
  optimization_confidence numeric,
  optimizer_version text,
  rollback_snapshot jsonb default '{}'::jsonb,
  fb_listing_id text,
  fb_group_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists posting_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  completed_at timestamptz,
  item_count int default 0,
  posted_count int default 0,
  failed_count int default 0,
  status text default 'active',
  notes text,
  created_at timestamptz default now()
);

create table if not exists posting_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references posting_sessions(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete cascade,
  result text default 'pending',
  fb_listing_id text,
  error_message text,
  images_uploaded int default 0,
  duration_ms int,
  posted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists crm_threads (
  id uuid primary key default gen_random_uuid(),
  external_thread_id text unique,
  platform text default 'facebook',
  customer_name text,
  customer_profile_url text,
  thread_path text,
  status text default 'open',
  tags jsonb default '[]'::jsonb,
  notes text,
  item_title text,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  last_message_at timestamptz,
  overdue_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references crm_threads(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  state text default 'eligible',
  template_name text,
  requested_at timestamptz,
  follow_up_at timestamptz,
  review_received_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_inventory_status on inventory_items(status);
create index if not exists idx_inventory_created on inventory_items(created_at desc);
create index if not exists idx_inventory_upc on inventory_items(upc);
create index if not exists idx_inventory_opt_status on inventory_items(optimization_status);
create index if not exists idx_posting_results_item on posting_results(inventory_item_id);
create index if not exists idx_posting_results_session on posting_results(session_id);
create index if not exists idx_crm_status on crm_threads(status);
create index if not exists idx_crm_last_msg on crm_threads(last_message_at desc);

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists inventory_items_updated_at on inventory_items;
create trigger inventory_items_updated_at before update on inventory_items
for each row execute function update_updated_at();

drop trigger if exists crm_threads_updated_at on crm_threads;
create trigger crm_threads_updated_at before update on crm_threads
for each row execute function update_updated_at();

-- Additional fields and views from final audit
alter table inventory_items
  add column if not exists location text,
  add column if not exists optimizer_notes text,
  add column if not exists optimizer_model text;

create table if not exists crm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references crm_threads(id) on delete cascade,
  sender text,
  body text,
  sent_at timestamptz,
  is_system boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_crm_messages_thread on crm_messages(thread_id);
create index if not exists idx_crm_messages_sent on crm_messages(sent_at desc);

create or replace view inventory_stats_by_status as
  select
    status,
    count(*) as total,
    max(updated_at) as last_updated,
    avg(price) as avg_price,
    sum(case when listed_at is not null then 1 else 0 end) as with_listing
  from inventory_items
  group by status;

create or replace view posting_session_summary as
  select
    ps.id,
    ps.started_at,
    ps.completed_at,
    ps.status,
    ps.item_count,
    ps.posted_count,
    ps.failed_count,
    count(pr.id) as result_count,
    avg(pr.duration_ms) as avg_duration_ms,
    sum(pr.images_uploaded) as total_images
  from posting_sessions ps
  left join posting_results pr on pr.session_id = ps.id
  group by ps.id;
