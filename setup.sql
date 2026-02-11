-- Pod Dashboard — Supabase Schema
-- Run this in the Supabase SQL Editor

-- Members
create table members (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamptz default now()
);

-- Meetings
create table meetings (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  title text default '',
  summary text default '',
  created_at timestamptz default now()
);

-- Attendance
create table attendance (
  id uuid default gen_random_uuid() primary key,
  meeting_id uuid references meetings(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  present boolean default false
);

-- Agenda items
create table agenda_items (
  id uuid default gen_random_uuid() primary key,
  meeting_id uuid references meetings(id) on delete cascade,
  text text not null,
  duration_min integer default 5,
  position integer default 0,
  created_at timestamptz default now()
);

-- Topics (global, not per meeting)
create table topics (
  id uuid default gen_random_uuid() primary key,
  text text not null,
  added_by text default '',
  discussed boolean default false,
  meeting_id uuid references meetings(id) on delete set null,
  created_at timestamptz default now()
);

-- Check-ins
create table checkins (
  id uuid default gen_random_uuid() primary key,
  meeting_id uuid references meetings(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  goals text default '',
  progress text default '',
  challenges text default '',
  support text default '',
  screenshot_url text,
  created_at timestamptz default now()
);

-- Enable RLS but allow all operations with anon key (simple password protection is in frontend)
alter table members enable row level security;
alter table meetings enable row level security;
alter table attendance enable row level security;
alter table agenda_items enable row level security;
alter table topics enable row level security;
alter table checkins enable row level security;

-- Policies: allow all operations for anon
create policy "Allow all" on members for all using (true) with check (true);
create policy "Allow all" on meetings for all using (true) with check (true);
create policy "Allow all" on attendance for all using (true) with check (true);
create policy "Allow all" on agenda_items for all using (true) with check (true);
create policy "Allow all" on topics for all using (true) with check (true);
create policy "Allow all" on checkins for all using (true) with check (true);

-- Storage bucket for check-in screenshots
insert into storage.buckets (id, name, public) values ('checkins', 'checkins', true);
create policy "Allow all uploads" on storage.objects for all using (bucket_id = 'checkins') with check (bucket_id = 'checkins');

-- Enable Realtime
alter publication supabase_realtime add table agenda_items;
alter publication supabase_realtime add table attendance;
alter publication supabase_realtime add table topics;
alter publication supabase_realtime add table checkins;

-- Seed: Add your pod members (change names!)
insert into members (name) values
  ('Remy'),
  ('Lid 2'),
  ('Lid 3'),
  ('Lid 4'),
  ('Lid 5');
