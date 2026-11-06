-- =====================================================================
-- DATABASE SECURITY TEST  (run in the Supabase SQL Editor)
--
-- Run AFTER schema.sql (login + security hardening are included in it).
-- It creates fake accounts and test data, then acts as each kind of user
-- (anonymous, stranger, pending, member, admin) and checks what they can and
-- cannot do. Nothing is kept: the script ends with a DELIBERATE error whose
-- message is the test report, which rolls everything back.
--
-- How to read it: look at the error message at the bottom.
--   "0 failed"  -> every check passed.
--   any FAIL line -> that rule is not being enforced; do NOT deploy until fixed.
-- =====================================================================

begin;

-- ---------- helpers (invoker rights, so row-level security applies to the test user) ----------
create table public.zz_results (id serial primary key, label text, passed boolean);

create function public.zz_check(label text, ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.zz_results (label, passed) values (label, coalesce(ok, false));
end $$;

-- Runs a statement; returns 'ok:<rows affected>' or 'err:<sqlstate>'
create function public.zz_try(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;

-- Counts the rows a query can see; -1 if it is not allowed at all
create function public.zz_count(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
exception when others then
  return -1;
end $$;

-- ---------- fixtures (created as the database owner) ----------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test_admin@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test_member@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'test_pending@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'test_stranger@example.test');

insert into kstransfers.members (user_id, email, role, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test_admin@example.test', 'admin', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test_member@example.test', 'member', now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'test_pending@example.test', 'pending', null);

insert into kstransfers.cycles (id, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '__rls_test_cycle__');
insert into kstransfers.prospects (id, cycle_id, player_id, ign)
  values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '111222333', '__rls_test_player__');

-- =====================================================================
-- 1) ANONYMOUS visitor (no login)
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select public.zz_check('anon: cannot read cycles',     public.zz_count($q$select 1 from kstransfers.cycles$q$)     <= 0);
select public.zz_check('anon: cannot read prospects',  public.zz_count($q$select 1 from kstransfers.prospects$q$)  <= 0);
select public.zz_check('anon: cannot read members',    public.zz_count($q$select 1 from kstransfers.members$q$)    <= 0);
select public.zz_check('anon: cannot read audit log',  public.zz_count($q$select 1 from kstransfers.audit_log$q$)  <= 0);
select public.zz_check('anon: cannot insert a prospect',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','999888777','x')$q$) like 'err:%');
select public.zz_check('anon: cannot create a cycle',
  public.zz_try($q$insert into kstransfers.cycles (name) values ('x')$q$) like 'err:%');
select public.zz_check('anon: cannot request access',
  public.zz_try($q$select kstransfers.request_access()$q$) like 'err:%');
reset role;

-- =====================================================================
-- 2) STRANGER: signed in, has never requested access
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000004","email":"test_stranger@example.test","role":"authenticated"}', true);
set local role authenticated;

select public.zz_check('stranger: sees no cycles',     public.zz_count($q$select 1 from kstransfers.cycles$q$)    = 0);
select public.zz_check('stranger: sees no prospects',  public.zz_count($q$select 1 from kstransfers.prospects$q$) = 0);
select public.zz_check('stranger: cannot insert a prospect',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','999888777','x')$q$) like 'err:%');
select public.zz_check('stranger: asking for access makes them PENDING (not admin/member)',
  (select kstransfers.request_access()) = 'pending');
select public.zz_check('stranger: still sees nothing after asking', public.zz_count($q$select 1 from kstransfers.cycles$q$) = 0);
reset role;

select public.zz_check('stranger: a pending row was created',
  exists (select 1 from kstransfers.members where user_id = 'aaaaaaaa-0000-0000-0000-000000000004' and role = 'pending'));

-- =====================================================================
-- 3) PENDING user (waiting for approval)
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","email":"test_pending@example.test","role":"authenticated"}', true);
set local role authenticated;

select public.zz_check('pending: sees no cycles',     public.zz_count($q$select 1 from kstransfers.cycles$q$)    = 0);
select public.zz_check('pending: sees no prospects',  public.zz_count($q$select 1 from kstransfers.prospects$q$) = 0);
select public.zz_check('pending: sees no audit log',  public.zz_count($q$select 1 from kstransfers.audit_log$q$) = 0);
select public.zz_check('pending: can only see their own membership row', public.zz_count($q$select 1 from kstransfers.members$q$) = 1);
select public.zz_check('pending: cannot insert a prospect',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','999888777','x')$q$) like 'err:%');
select public.zz_check('pending: cannot edit a prospect',
  public.zz_try($q$update kstransfers.prospects set ign = 'hacked' where id = 'cccccccc-0000-0000-0000-000000000001'$q$) = 'ok:0');
select public.zz_check('pending: cannot delete a prospect',
  public.zz_try($q$delete from kstransfers.prospects where id = 'cccccccc-0000-0000-0000-000000000001'$q$) = 'ok:0');
select public.zz_check('pending: cannot approve themselves',
  public.zz_try($q$update kstransfers.members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$) = 'ok:0');
reset role;

select public.zz_check('pending: data is untouched',
  (select ign from kstransfers.prospects where id = 'cccccccc-0000-0000-0000-000000000001') = '__rls_test_player__');
select public.zz_check('pending: is still pending',
  (select role from kstransfers.members where user_id = 'aaaaaaaa-0000-0000-0000-000000000003') = 'pending');

-- =====================================================================
-- 4) MEMBER (approved, not admin)
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","email":"test_member@example.test","role":"authenticated"}', true);
set local role authenticated;

select public.zz_check('member: can read cycles',     public.zz_count($q$select 1 from kstransfers.cycles$q$)    >= 1);
select public.zz_check('member: can read prospects',  public.zz_count($q$select 1 from kstransfers.prospects$q$) >= 1);
select public.zz_check('member: can read the audit log', public.zz_count($q$select 1 from kstransfers.audit_log$q$) >= 1);
select public.zz_check('member: cannot see other people''s membership rows', public.zz_count($q$select 1 from kstransfers.members$q$) = 1);

select public.zz_check('member: can add a prospect',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','444555666','__t__')$q$) = 'ok:1');
select public.zz_check('member: can edit a prospect',
  public.zz_try($q$update kstransfers.prospects set status = 'In Talks' where id = 'cccccccc-0000-0000-0000-000000000001'$q$) = 'ok:1');

-- database-level validation (rejected even though the user is allowed to write)
select public.zz_check('validation: non-numeric player id rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','abc','x')$q$) = 'err:23514');
select public.zz_check('validation: SQL-looking player id rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','1; drop table x','x')$q$) = 'err:23514');
select public.zz_check('validation: 61-character name rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign) values ('bbbbbbbb-0000-0000-0000-000000000001','777888999', repeat('x', 61))$q$) = 'err:23514');
select public.zz_check('validation: unknown invite type rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign, invite_type) values ('bbbbbbbb-0000-0000-0000-000000000001','777888999','x','VIP')$q$) = 'err:23514');
select public.zz_check('validation: kingdom 100000 rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign, kingdom) values ('bbbbbbbb-0000-0000-0000-000000000001','777888999','x',100000)$q$) = 'err:23514');
select public.zz_check('validation: negative power rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign, power) values ('bbbbbbbb-0000-0000-0000-000000000001','777888999','x',-1)$q$) = 'err:23514');
select public.zz_check('validation: 2001-character note rejected',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign, notes) values ('bbbbbbbb-0000-0000-0000-000000000001','777888999','x', repeat('n', 2001))$q$) = 'err:23514');
select public.zz_check('validation: cycle ending before it starts rejected',
  public.zz_try($q$insert into kstransfers.cycles (name, start_date, end_date) values ('x','2026-01-10','2026-01-01')$q$) = 'err:23514');
select public.zz_check('validation: injection-looking text is stored as plain text',
  public.zz_try($q$insert into kstransfers.prospects (cycle_id, player_id, ign, notes) values ('bbbbbbbb-0000-0000-0000-000000000001','777888111','Robert''); DROP TABLE prospects;--','<script>alert(1)</script>')$q$) = 'ok:1');
select public.zz_check('member: can delete a prospect',
  public.zz_try($q$delete from kstransfers.prospects where ign = '__t__'$q$) = 'ok:1');

-- the audit log cannot be tampered with
select public.zz_check('audit: member cannot insert entries',
  public.zz_try($q$insert into kstransfers.audit_log (action, table_name) values ('INSERT','prospects')$q$) like 'err:%');
select public.zz_check('audit: member cannot edit entries',
  public.zz_try($q$update kstransfers.audit_log set summary = 'x'$q$) like 'err:%');
select public.zz_check('audit: member cannot delete entries',
  public.zz_try($q$delete from kstransfers.audit_log$q$) like 'err:%');

-- privilege escalation attempts
select public.zz_check('member: cannot promote themselves to admin',
  public.zz_try($q$update kstransfers.members set role = 'admin' where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'$q$) = 'ok:0');
select public.zz_check('member: cannot add membership rows directly',
  public.zz_try($q$insert into kstransfers.members (user_id, email, role) values ('aaaaaaaa-0000-0000-0000-000000000004','x','admin')$q$) like 'err:%');
select public.zz_check('member: cannot approve someone else',
  public.zz_try($q$update kstransfers.members set role = 'member' where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$) = 'ok:0');
select public.zz_check('member: cannot call internal trigger functions',
  public.zz_try($q$select kstransfers.log_change()$q$) like 'err:%');
reset role;

select public.zz_check('audit: the change was recorded with the signed-in email',
  (select actor from kstransfers.audit_log where summary = '__t__' and action = 'INSERT' order by id desc limit 1) = 'test_member@example.test');
select public.zz_check('audit: the deletion kept the deleted record''s data',
  (select old_data ->> 'ign' from kstransfers.audit_log where summary = '__t__' and action = 'DELETE' order by id desc limit 1) = '__t__');
select public.zz_check('audit: edits record old and new values',
  (select changed -> 'status' ->> 'to' from kstransfers.audit_log
     where record_id = 'cccccccc-0000-0000-0000-000000000001' and action = 'UPDATE' order by id desc limit 1) = 'In Talks');
select public.zz_check('audit: injection-looking text was stored verbatim and the table still exists',
  exists (select 1 from kstransfers.prospects where ign like 'Robert%DROP TABLE%'));

-- =====================================================================
-- 5) ADMIN
-- =====================================================================
-- make the test admin the only admin so the "last admin" guard can be tested
delete from kstransfers.members where role = 'admin' and user_id <> 'aaaaaaaa-0000-0000-0000-000000000001';

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","email":"test_admin@example.test","role":"authenticated"}', true);
set local role authenticated;

select public.zz_check('admin: sees every membership row', public.zz_count($q$select 1 from kstransfers.members$q$) >= 4);
select public.zz_check('admin: can approve a pending user',
  public.zz_try($q$update kstransfers.members set role = 'member', approved_at = now() where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'$q$) = 'ok:1');
select public.zz_check('admin: cannot demote the last admin',
  public.zz_try($q$update kstransfers.members set role = 'member' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'err:P0001');
select public.zz_check('admin: cannot delete the last admin',
  public.zz_try($q$delete from kstransfers.members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'err:P0001');
select public.zz_check('admin: can remove a member',
  public.zz_try($q$delete from kstransfers.members where user_id = 'aaaaaaaa-0000-0000-0000-000000000004'$q$) = 'ok:1');
select public.zz_check('admin: still cannot edit the audit log',
  public.zz_try($q$update kstransfers.audit_log set summary = 'x'$q$) like 'err:%');
reset role;

-- =====================================================================
-- 6) Approval actually unlocks access
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","email":"test_pending@example.test","role":"authenticated"}', true);
set local role authenticated;
select public.zz_check('approved user can now read cycles', public.zz_count($q$select 1 from kstransfers.cycles$q$) >= 1);
reset role;

-- =====================================================================
-- REPORT: ends with a deliberate error so that everything is rolled back
-- =====================================================================
do $t$
declare
  report text;
  bad int;
  total int;
begin
  select count(*) filter (where not passed), count(*),
         string_agg((case when passed then 'PASS  ' else 'FAIL  ' end) || label, E'\n' order by id)
    into bad, total, report
    from public.zz_results;
  raise exception E'\n\nDB SECURITY TEST REPORT: % failed of % checks\n\n%\n\n(This error is intentional: it rolls back the test data.)', bad, total, report;
end $t$;
