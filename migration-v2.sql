-- Run this in Supabase SQL Editor to update to v2

-- 1. Make agenda_items shared (remove meeting_id requirement)
alter table agenda_items alter column meeting_id drop not null;
alter table agenda_items alter column meeting_id set default null;

-- 2. Clean up duplicate attendance records (keep first per member per meeting)
delete from attendance a using attendance b
where a.id > b.id
  and a.meeting_id = b.meeting_id
  and a.member_id = b.member_id;

-- 3. Add unique constraint to prevent future duplicates
alter table attendance add constraint unique_member_meeting unique (meeting_id, member_id);
