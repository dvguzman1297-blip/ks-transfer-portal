-- Public transfer requests. Safe to re-run. Run in the Supabase SQL Editor.
-- Visitors never touch the database directly: the /api/request route inserts with the service-role key.
-- Approved members can read and manage the inbox, and get live updates through Supabase Realtime.

create table if not exists kstransfers.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed')),
  player_id text not null,
  ign text not null,
  kingdom integer,
  power bigint not null default 0,
  current_alliance text,
  truegold_grade text,
  transfer_passes integer not null,
  transfer_window text not null,
  looking_for text not null,
  contacted_1886 boolean not null default false,
  contacted_who text,
  contact_handle text,
  message text,
  constraint transfer_requests_sane check (
    player_id ~ '^[0-9]{3,20}$'
    and char_length(btrim(ign)) between 1 and 60
    and power between 0 and 100000000000000
    and transfer_passes between 0 and 99
    and char_length(transfer_window) <= 80
    and char_length(looking_for) <= 80
    and (contacted_who is null or char_length(contacted_who) <= 60)
    and (contact_handle is null or char_length(contact_handle) <= 60)
    and (message is null or char_length(message) <= 500)
  )
);

-- one waiting request per player at a time
create unique index if not exists transfer_requests_one_new on kstransfers.transfer_requests (player_id) where status = 'new';
create index if not exists transfer_requests_status_idx on kstransfers.transfer_requests (status, created_at desc);

alter table kstransfers.transfer_requests enable row level security;
revoke all on kstransfers.transfer_requests from anon, authenticated;
grant select, update, delete on kstransfers.transfer_requests to authenticated;

drop policy if exists requests_select on kstransfers.transfer_requests;
create policy requests_select on kstransfers.transfer_requests for select to authenticated using (kstransfers.is_approved());
drop policy if exists requests_update on kstransfers.transfer_requests;
create policy requests_update on kstransfers.transfer_requests for update to authenticated
  using (kstransfers.is_approved()) with check (kstransfers.is_approved());
drop policy if exists requests_delete on kstransfers.transfer_requests;
create policy requests_delete on kstransfers.transfer_requests for delete to authenticated using (kstransfers.is_approved());

-- the service role used by /api/request bypasses RLS but still needs table privileges
grant usage on schema kstransfers to service_role;
grant select, insert, update, delete on kstransfers.transfer_requests to service_role;

-- live notifications
do $$ begin
  alter publication supabase_realtime add table kstransfers.transfer_requests;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Link a request to the cycle (transfer window) the player picked. Safe to re-run.
-- cycle_id is null when the player chose "Not sure yet" or the cycle was deleted later.
-- ---------------------------------------------------------------------
alter table kstransfers.transfer_requests add column if not exists cycle_id uuid references kstransfers.cycles(id) on delete set null;
create index if not exists transfer_requests_cycle_idx on kstransfers.transfer_requests (cycle_id);

-- /api/request and /api/transfer-windows read the open cycles with the service-role key
grant select on kstransfers.cycles to service_role;

-- ---------------------------------------------------------------------
-- "Next window" requests: the player picked the window after the latest open cycle, which may not exist yet.
-- after_date = start date of the latest open cycle at submission (or the submission date if none was open).
-- The request belongs to the earliest cycle that starts after that date. Null for every other request.
-- ---------------------------------------------------------------------
alter table kstransfers.transfer_requests add column if not exists after_date date;
