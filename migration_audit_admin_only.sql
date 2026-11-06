-- Audit log is visible to admins only. Safe to re-run.
drop policy if exists audit_read on kstransfers.audit_log;
create policy audit_read on kstransfers.audit_log for select to authenticated
  using (kstransfers.is_admin());
