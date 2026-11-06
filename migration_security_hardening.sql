
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
) not valid;

alter table kstransfers.members drop constraint if exists members_sane_values;
alter table kstransfers.members add constraint members_sane_values check (
  char_length(email) <= 320
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
