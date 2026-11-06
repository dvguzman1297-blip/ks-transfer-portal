-- Invite / slot totals per transfer cycle. Safe to re-run.
-- Ordinary kingdom: 3 special, 35 ordinary, 20 open.  Leading kingdom: 0 special, 20 ordinary, 10 open.
alter table kstransfers.cycles add column if not exists ordinary_slots integer not null default 0;
alter table kstransfers.cycles add column if not exists special_slots integer not null default 0;
alter table kstransfers.cycles add column if not exists open_slots integer not null default 0;

alter table kstransfers.cycles drop constraint if exists cycles_sane_values;
alter table kstransfers.cycles add constraint cycles_sane_values check (
  char_length(btrim(name)) between 1 and 80
  and (end_date is null or end_date >= start_date)
  and ordinary_slots between 0 and 1000
  and special_slots between 0 and 1000
  and open_slots between 0 and 1000
) not valid;
