-- Run this in the Supabase SQL editor.
-- Creates a simple key/value table that mirrors the artifact's window.storage API.

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security (required by Supabase)
alter table kv_store enable row level security;

-- Public read/write policy. This is a single-user app — anyone with the URL
-- can read/write. If you want auth later, replace with auth.uid() checks.
create policy "Public read/write" on kv_store
  for all
  using (true)
  with check (true);
