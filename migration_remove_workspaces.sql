-- Run once in the Supabase SQL Editor to go back to a single shared tracker (no login, no workspaces).
-- Your cycles and prospects are kept.

-- 1) Remove the workspace-based policies
drop policy if exists cycles_select on kstransfers.cycles;
drop policy if exists cycles_insert on kstransfers.cycles;
drop policy if exists cycles_update on kstransfers.cycles;
drop policy if exists cycles_delete on kstransfers.cycles;
drop policy if exists pros_select on kstransfers.prospects;
drop policy if exists pros_insert on kstransfers.prospects;
drop policy if exists pros_update on kstransfers.prospects;
drop policy if exists pros_delete on kstransfers.prospects;

-- 2) Remove workspace tables, helpers and the cycle link
drop table if exists kstransfers.workspace_invites cascade;
drop table if exists kstransfers.workspace_members cascade;
drop table if exists kstransfers.workspaces cascade;
alter table kstransfers.cycles drop column if exists workspace_id;

drop function if exists kstransfers.guard_last_owner();
drop function if exists kstransfers.accept_invite(uuid);
drop function if exists kstransfers.invite_info(uuid);
drop function if exists kstransfers.create_workspace(text);
drop function if exists kstransfers.is_owner(uuid);
drop function if exists kstransfers.can_edit(uuid);
drop function if exists kstransfers.is_member(uuid);

-- 3) Restore open access
grant usage on schema kstransfers to anon, authenticated;
grant select, insert, update, delete on all tables in schema kstransfers to anon, authenticated;
alter default privileges in schema kstransfers
  grant select, insert, update, delete on tables to anon, authenticated;

alter table kstransfers.cycles enable row level security;
alter table kstransfers.prospects enable row level security;

drop policy if exists "open cycles" on kstransfers.cycles;
create policy "open cycles" on kstransfers.cycles
  for all to anon, authenticated using (true) with check (true);
drop policy if exists "open prospects" on kstransfers.prospects;
create policy "open prospects" on kstransfers.prospects
  for all to anon, authenticated using (true) with check (true);
