-- Run this in Supabase SQL Editor for v3 features

-- 1. Default agenda template table
create table agenda_defaults (
  id uuid default gen_random_uuid() primary key,
  text text not null,
  duration_min integer default 5,
  position integer default 0
);

alter table agenda_defaults enable row level security;
create policy "Allow all" on agenda_defaults for all using (true) with check (true);

-- 2. Make agenda_items per-meeting again (was shared in v2, now per-meeting with template)
-- If you had shared agenda items without meeting_id, you can delete them:
-- delete from agenda_items where meeting_id is null;

-- 3. Enable realtime for agenda_defaults
alter publication supabase_realtime add table agenda_defaults;
