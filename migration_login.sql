
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
  approved_at timestamptz
);

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
  who := nullif(auth.jwt() ->> 'email', '');

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
    label := rec ->> 'email';
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
  using (kstransfers.is_approved());

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
