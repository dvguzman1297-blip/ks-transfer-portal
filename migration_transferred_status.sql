-- Adds the "Transferred" prospect status.
alter table kstransfers.prospects drop constraint if exists prospects_status_check;
alter table kstransfers.prospects add constraint prospects_status_check
  check (status in ('Not Contacted','In Talks','Considering','Invitation Sent','Committed','Transferred','Rejected','Not Coming'));
