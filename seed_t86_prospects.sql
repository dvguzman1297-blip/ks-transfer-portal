-- TEST DATA: adds 10 fake prospects assigned to T86 in the newest cycle whose name starts with "Transfer 9".
-- Every test row's notes start with "[TEST]" so they can be removed again (see the bottom of this file).
-- Run in the Supabase SQL Editor. Running it twice adds a second batch (use the cleanup first).

do $seed$
declare
  cid uuid;
begin
  select c.id into cid from kstransfers.cycles c where c.name ilike 'Transfer 9%' order by c.created_at desc limit 1;
  if cid is null then raise exception 'No cycle named "Transfer 9..." found'; end if;

  insert into kstransfers.prospects
    (cycle_id, player_id, ign, kingdom, power, recruiter, status, alliance, truegold_grade, assigned_alliance, invite_type, notes, updated_at)
  values
    (cid, '410000101', 'TavernKnight',   1042, 182000000, 'Aria',  'Not Contacted', '[T86] GemstoneTavern', 'TG3', 'T86', 'Open',     '[TEST] Found via kingdom leaderboard.',                         now() - interval '1 day'),
    (cid, '410000202', 'GemHunter86',    1118,  96500000, 'Dax',   'In Talks',      '[T86] GemstoneTavern', 'TG2', 'T86', 'Special',  '[TEST] Talked in Discord, interested in a relaxed alliance.',   now() - interval '2 days'),
    (cid, '410000303', 'AleBrewer',      1205,  54300000, 'Mikko', 'In Talks',      '[T86] GemstoneTavern', 'TG1', 'T86', 'Ordinary', '[TEST] Wants to bring two friends along.',                      now() - interval '3 days'),
    (cid, '410000404', 'BarrelRoller',   1067, 140250000, 'Sol',   'Considering',   '[T86] GemstoneTavern', 'TG4', 'T86', 'Special',  '[TEST] Waiting on their kingdom to confirm transfer pass.',     now() - interval '4 days'),
    (cid, '410000505', 'CrystalCaster',  1390,  73800000, 'Tane',  'Considering',   '[T86] GemstoneTavern', 'TG2', 'T86', 'Open',     '[TEST] Prefers voice chat, evenings (UTC+8).',                  now() - interval '5 days'),
    (cid, '410000606', 'LanternBearer',  1153, 215000000, 'Aria',  'Committed',     '[T86] GemstoneTavern', 'TG5', 'T86', 'Special',  '[TEST] Strong in KvK, wants an active alliance with rally leaders.', now() - interval '6 hours'),
    (cid, '410000707', 'OakShield',      1276,  38900000, null,    'Not Contacted', '[T86] GemstoneTavern', null,  'T86', 'Open',     '[TEST] ',                                                       now() - interval '7 days'),
    (cid, '410000808', 'MeadMaster',     1011, 121700000, 'Dax',   'Committed',     '[T86] GemstoneTavern', 'TG3', 'T86', 'Ordinary', '[TEST] Confirmed, arriving at the start of the transfer window.', now() - interval '2 days'),
    (cid, '410000909', 'PubCrawler',     1334,  66400000, 'Mikko', 'Rejected',      '[T86] GemstoneTavern', 'TG1', 'T86', 'Open',     '[TEST] Decided to stay in their current kingdom.',              now() - interval '8 days'),
    (cid, '410001010', 'HearthKeeper',   1099, 158600000, 'Sol',   'In Talks',      '[T86] GemstoneTavern', 'TG4', 'T86', 'Special',  '[TEST] Asked about the daily schedule and migrations as a group.', now() - interval '12 hours');
end $seed$;

-- =====================================================================
-- CLEANUP: run this to remove only the test prospects
-- (the audit log will record the additions and removals; that is expected)
-- =====================================================================
-- delete from kstransfers.prospects where notes like '[TEST]%';
