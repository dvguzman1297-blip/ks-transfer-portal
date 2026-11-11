-- Kingshot Transfer Portal: run this in the Supabase SQL Editor (safe to re-run).
-- Already ran the workspaces/login version? Run migration_remove_workspaces.sql instead.
create extension if not exists pgcrypto;

create schema if not exists kstransfers;

create table if not exists kstransfers.cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_kingdom text,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create table if not exists kstransfers.prospects (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references kstransfers.cycles(id) on delete cascade,
  player_id text not null,
  ign text not null,
  kingdom integer,
  power bigint not null default 0,
  role text,
  recruiter text,
  status text not null default 'Not Contacted'
    check (status in ('Not Contacted','In Talks','Considering','Invitation Sent','Committed','Rejected','Not Coming')),
  alliance text,
  truegold_grade text,
  notes text,
  updated_at timestamptz not null default now()
);

-- Columns added in later versions (for databases created from an older schema)
alter table kstransfers.cycles add column if not exists end_date date;
alter table kstransfers.cycles add column if not exists ordinary_slots integer not null default 0;
alter table kstransfers.cycles add column if not exists special_slots integer not null default 0;
alter table kstransfers.cycles add column if not exists open_slots integer not null default 0;
alter table kstransfers.prospects add column if not exists alliance text;
alter table kstransfers.prospects add column if not exists truegold_grade text;

create index if not exists prospects_cycle_idx on kstransfers.prospects(cycle_id);

create or replace function kstransfers.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists prospects_touch on kstransfers.prospects;
create trigger prospects_touch before update on kstransfers.prospects
  for each row execute function kstransfers.touch_updated_at();

-- API access (ALSO add `kstransfers` under Settings > API > Exposed schemas)
grant usage on schema kstransfers to anon, authenticated;
grant select, insert, update, delete on all tables in schema kstransfers to anon, authenticated;
alter default privileges in schema kstransfers
  grant select, insert, update, delete on tables to anon, authenticated;

alter table kstransfers.cycles enable row level security;
alter table kstransfers.prospects enable row level security;

-- NOTE: no login. Anyone who can open the site (and holds the public anon key) can read and write.
-- Keep the URL private, or add Vercel password protection.
drop policy if exists "open cycles" on kstransfers.cycles;
create policy "open cycles" on kstransfers.cycles
  for all to anon, authenticated using (true) with check (true);
drop policy if exists "open prospects" on kstransfers.prospects;
create policy "open prospects" on kstransfers.prospects
  for all to anon, authenticated using (true) with check (true);
alter table kstransfers.prospects add column if not exists assigned_alliance text;
alter table kstransfers.prospects add column if not exists invite_type text;

-- =====================================================================
-- Audit log (safe to re-run). Every insert / update / delete on cycles
-- and prospects is recorded by database triggers, so it cannot be skipped
-- by the app, and the log itself is read-only through the API.
-- =====================================================================

create table if not exists kstransfers.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid,
  cycle_id uuid,
  cycle_name text,
  summary text,
  old_data jsonb,
  new_data jsonb,
  changed jsonb,
  actor text
);

create index if not exists audit_log_at_idx on kstransfers.audit_log (at desc, id desc);

create or replace function kstransfers.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  old_j jsonb;
  new_j jsonb;
  diff jsonb;
  who text;
  cyc uuid;
  cname text;
  label text;
begin
  -- Name the user typed into the app, sent as the x-actor request header (informational only)
  who := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-actor', '');

  if tg_op = 'INSERT' then
    new_j := to_jsonb(new);
    rec := new_j;
  elsif tg_op = 'DELETE' then
    old_j := to_jsonb(old);
    rec := old_j;
  else
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    rec := new_j;
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into diff
      from jsonb_each(new_j) n
      join jsonb_each(old_j) o on o.key = n.key
      where n.value is distinct from o.value and n.key <> 'updated_at';
    if diff is null then
      return new; -- nothing meaningful changed
    end if;
  end if;

  if tg_table_name = 'prospects' then
    cyc := (rec ->> 'cycle_id')::uuid;
    select c.name into cname from kstransfers.cycles c where c.id = cyc;
    label := rec ->> 'ign';
  else
    cyc := (rec ->> 'id')::uuid;
    cname := rec ->> 'name';
    label := rec ->> 'name';
  end if;

  insert into kstransfers.audit_log
    (action, table_name, record_id, cycle_id, cycle_name, summary, old_data, new_data, changed, actor)
  values
    (tg_op, tg_table_name, (rec ->> 'id')::uuid, cyc, cname, label, old_j, new_j, diff, who);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists cycles_audit on kstransfers.cycles;
create trigger cycles_audit after insert or update or delete on kstransfers.cycles
  for each row execute function kstransfers.log_change();

drop trigger if exists prospects_audit on kstransfers.prospects;
create trigger prospects_audit after insert or update or delete on kstransfers.prospects
  for each row execute function kstransfers.log_change();

-- Read-only through the API: nobody can edit or erase log entries
alter table kstransfers.audit_log enable row level security;
revoke all on kstransfers.audit_log from anon, authenticated;
grant select on kstransfers.audit_log to anon, authenticated;

drop policy if exists audit_read on kstransfers.audit_log;
create policy audit_read on kstransfers.audit_log for select to anon, authenticated using (true);

-- =====================================================================
-- Login: only approved members can use the portal (safe to re-run)
-- The first account to sign in becomes the admin; everyone after that
-- waits as "pending" until an admin approves them in the app.
-- =====================================================================

create table if not exists kstransfers.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'pending' check (role in ('admin', 'member', 'pending')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  display_name text
);
alter table kstransfers.members add column if not exists display_name text;

create or replace function kstransfers.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from kstransfers.members m
                 where m.user_id = auth.uid() and m.role in ('admin', 'member'));
$$;

create or replace function kstransfers.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from kstransfers.members m
                 where m.user_id = auth.uid() and m.role = 'admin');
$$;

-- Called by the app after every sign-in: returns the caller's role,
-- creating a pending row (or the very first admin row) if they have none.
create or replace function kstransfers.request_access() returns text
language plpgsql security definer set search_path = '' as $$
declare
  r text;
  first_user boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select m.role into r from kstransfers.members m where m.user_id = auth.uid();
  if found then return r; end if;

  first_user := not exists (select 1 from kstransfers.members);
  r := case when first_user then 'admin' else 'pending' end;

  insert into kstransfers.members (user_id, email, role, approved_at)
    values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), r, case when first_user then now() end);
  return r;
end $$;

-- There must always be at least one admin
create or replace function kstransfers.guard_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from kstransfers.members m where m.role = 'admin' and m.user_id <> old.user_id)
  then
    raise exception 'The portal must keep at least one admin';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists members_guard_last_admin on kstransfers.members;
create trigger members_guard_last_admin before update or delete on kstransfers.members
  for each row execute function kstransfers.guard_last_admin();

-- The audit trigger now records the signed-in user's verified email, and also covers member changes
create or replace function kstransfers.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb;
  old_j jsonb;
  new_j jsonb;
  diff jsonb;
  who text;
  rid uuid;
  cyc uuid;
  cname text;
  label text;
begin
  -- The actor is the signed-in user's chosen display name (their verified email if they have none yet)
  select coalesce(nullif(btrim(m.display_name), ''), nullif(auth.jwt() ->> 'email', ''))
    into who from kstransfers.members m where m.user_id = auth.uid();
  if who is null then who := nullif(auth.jwt() ->> 'email', ''); end if;

  if tg_op = 'INSERT' then
    new_j := to_jsonb(new);
    rec := new_j;
  elsif tg_op = 'DELETE' then
    old_j := to_jsonb(old);
    rec := old_j;
  else
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    rec := new_j;
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      into diff
      from jsonb_each(new_j) n
      join jsonb_each(old_j) o on o.key = n.key
      where n.value is distinct from o.value and n.key <> 'updated_at';
    if diff is null then
      return new;
    end if;
  end if;

  if tg_table_name = 'prospects' then
    rid := (rec ->> 'id')::uuid;
    cyc := (rec ->> 'cycle_id')::uuid;
    select c.name into cname from kstransfers.cycles c where c.id = cyc;
    label := rec ->> 'ign';
  elsif tg_table_name = 'members' then
    rid := (rec ->> 'user_id')::uuid;
    label := coalesce(nullif(rec ->> 'display_name', ''), rec ->> 'email');
  else
    rid := (rec ->> 'id')::uuid;
    cyc := rid;
    cname := rec ->> 'name';
    label := rec ->> 'name';
  end if;

  insert into kstransfers.audit_log
    (action, table_name, record_id, cycle_id, cycle_name, summary, old_data, new_data, changed, actor)
  values
    (tg_op, tg_table_name, rid, cyc, cname, label, old_j, new_j, diff, who);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists members_audit on kstransfers.members;
create trigger members_audit after insert or update or delete on kstransfers.members
  for each row execute function kstransfers.log_change();

revoke all on function kstransfers.request_access() from public, anon;
revoke all on function kstransfers.is_approved() from public, anon;
revoke all on function kstransfers.is_admin() from public, anon;
grant execute on function kstransfers.request_access(), kstransfers.is_approved(), kstransfers.is_admin()
  to authenticated;

-- Display names and the members list
-- (safe to re-run)
create unique index if not exists members_display_name_key on kstransfers.members (lower(display_name)) where display_name is not null;

-- A signed-in user sets or changes their own name (the table itself stays admin-only for edits)
create or replace function kstransfers.set_display_name(new_name text) returns void
language plpgsql security definer set search_path = '' as $
declare
  n text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  n := btrim(regexp_replace(coalesce(new_name, ''), '[[:cntrl:]]', '', 'g'));
  if char_length(n) < 1 or char_length(n) > 40 then
    raise exception 'Name must be 1 to 40 characters';
  end if;
  begin
    update kstransfers.members set display_name = n where user_id = auth.uid();
  exception when unique_violation then
    raise exception 'That name is already taken';
  end;
  if not found then raise exception 'No membership found'; end if;
end $;

-- The members list. Regular members get names only; admins also get emails, roles, dates and pending requests.
create or replace function kstransfers.list_members()
returns table (user_id uuid, display_name text, role text, email text, created_at timestamptz, approved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $
declare
  adm boolean;
begin
  if not kstransfers.is_approved() then raise exception 'Not allowed'; end if;
  adm := kstransfers.is_admin();
  return query
    select m.user_id, m.display_name,
           case when adm then m.role end,
           case when adm then m.email end,
           case when adm then m.created_at end,
           case when adm then m.approved_at end
    from kstransfers.members m
    where adm or m.role in ('admin', 'member')
    order by m.created_at;
end $;

revoke all on function kstransfers.set_display_name(text) from public, anon;
revoke all on function kstransfers.list_members() from public, anon;
grant execute on function kstransfers.set_display_name(text), kstransfers.list_members() to authenticated;

-- Lock out anonymous visitors completely; approved members get access
revoke all on all tables in schema kstransfers from anon, authenticated;
alter default privileges in schema kstransfers revoke all on tables from anon, authenticated;
grant select, insert, update, delete on kstransfers.cycles, kstransfers.prospects to authenticated;
grant select on kstransfers.audit_log to authenticated;
grant select, update, delete on kstransfers.members to authenticated;

alter table kstransfers.members enable row level security;

drop policy if exists "open cycles" on kstransfers.cycles;
drop policy if exists "open prospects" on kstransfers.prospects;
drop policy if exists approved_cycles on kstransfers.cycles;
create policy approved_cycles on kstransfers.cycles for all to authenticated
  using (kstransfers.is_approved()) with check (kstransfers.is_approved());
drop policy if exists approved_prospects on kstransfers.prospects;
create policy approved_prospects on kstransfers.prospects for all to authenticated
  using (kstransfers.is_approved()) with check (kstransfers.is_approved());

drop policy if exists audit_read on kstransfers.audit_log;
create policy audit_read on kstransfers.audit_log for select to authenticated
  using (kstransfers.is_admin());

drop policy if exists members_select on kstransfers.members;
create policy members_select on kstransfers.members for select to authenticated
  using (user_id = auth.uid() or kstransfers.is_admin());
drop policy if exists members_update on kstransfers.members;
create policy members_update on kstransfers.members for update to authenticated
  using (kstransfers.is_admin()) with check (kstransfers.is_admin());
drop policy if exists members_delete on kstransfers.members;
create policy members_delete on kstransfers.members for delete to authenticated
  using (kstransfers.is_admin());

-- To make a specific person the admin later (SQL editor):
--   update kstransfers.members set role = 'admin', approved_at = now() where email = 'you@example.com';

-- =====================================================================
-- Security hardening (safe to re-run). Run after the login migration.
-- =====================================================================

-- 1) Data validation inside the database, so bad data is rejected even if
--    someone bypasses the app and calls the API directly.
--    "not valid" = enforced for every new/changed row without failing on old rows.
alter table kstransfers.prospects drop constraint if exists prospects_sane_values;
alter table kstransfers.prospects add constraint prospects_sane_values check (
  player_id ~ '^[0-9]{3,20}$'
  and char_length(btrim(ign)) between 1 and 60
  and (kingdom is null or kingdom between 1 and 99999)
  and power between 0 and 100000000000000
  and (recruiter is null or char_length(recruiter) <= 60)
  and (alliance is null or char_length(alliance) <= 80)
  and (truegold_grade is null or char_length(truegold_grade) <= 20)
  and (assigned_alliance is null or char_length(assigned_alliance) <= 40)
  and (invite_type is null or invite_type in ('Open', 'Special', 'Ordinary'))
  and (notes is null or char_length(notes) <= 2000)
) not valid;

alter table kstransfers.cycles drop constraint if exists cycles_sane_values;
alter table kstransfers.cycles add constraint cycles_sane_values check (
  char_length(btrim(name)) between 1 and 80
  and (end_date is null or end_date >= start_date)
  and ordinary_slots between 0 and 1000
  and special_slots between 0 and 1000
  and open_slots between 0 and 1000
) not valid;

alter table kstransfers.members drop constraint if exists members_sane_values;
alter table kstransfers.members add constraint members_sane_values check (
  char_length(email) <= 320
  and (display_name is null or char_length(btrim(display_name)) between 1 and 40)
) not valid;

-- 2) Internal trigger functions must never be callable through the API.
revoke all on function kstransfers.log_change() from public, anon, authenticated;
revoke all on function kstransfers.guard_last_admin() from public, anon, authenticated;
revoke all on function kstransfers.touch_updated_at() from public, anon, authenticated;

-- 3) Anything created in this schema later is private by default.
alter default privileges in schema kstransfers revoke execute on functions from public, anon;
alter default privileges in schema kstransfers revoke all on tables from anon;
alter default privileges in schema kstransfers revoke all on sequences from anon;

-- 4) Anonymous (not signed-in) visitors get no access to this schema at all;
--    only signed-in users can even look inside it.
revoke all on schema kstransfers from public;
revoke all on schema kstransfers from anon;
grant usage on schema kstransfers to authenticated;
revoke all on all tables in schema kstransfers from anon;
revoke all on all functions in schema kstransfers from anon;

-- 5) The audit log can only ever be read through the API, never changed.
revoke insert, update, delete, truncate on kstransfers.audit_log from anon, authenticated;

-- 6) Row-level security must be on and enforced for every table.
alter table kstransfers.cycles enable row level security;
alter table kstransfers.prospects enable row level security;
alter table kstransfers.audit_log enable row level security;
alter table kstransfers.members enable row level security;
