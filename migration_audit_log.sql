
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
