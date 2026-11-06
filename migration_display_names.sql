-- Display names + members list. Safe to re-run.
-- 1) Every member picks a name on first login. The audit log shows that name instead of the email.
-- 2) Any approved member can see the members list; regular members see names only, admins also see emails.

alter table kstransfers.members add column if not exists display_name text;

alter table kstransfers.members drop constraint if exists members_sane_values;
alter table kstransfers.members add constraint members_sane_values check (
  char_length(email) <= 320
  and (display_name is null or char_length(btrim(display_name)) between 1 and 40)
) not valid;

create unique index if not exists members_display_name_key on kstransfers.members (lower(display_name)) where display_name is not null;

-- >>> functions
-- A signed-in user sets or changes their own name (the table itself stays admin-only for edits)
create or replace function kstransfers.set_display_name(new_name text) returns void
language plpgsql security definer set search_path = '' as $$
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
end $$;

-- The members list. Regular members get names only; admins also get emails, roles, dates and pending requests.
create or replace function kstransfers.list_members()
returns table (user_id uuid, display_name text, role text, email text, created_at timestamptz, approved_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
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
end $$;

revoke all on function kstransfers.set_display_name(text) from public, anon;
revoke all on function kstransfers.list_members() from public, anon;
grant execute on function kstransfers.set_display_name(text), kstransfers.list_members() to authenticated;
-- <<< functions

-- The audit trigger now records the display name (falling back to the email)
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

revoke all on function kstransfers.log_change() from public, anon, authenticated;
