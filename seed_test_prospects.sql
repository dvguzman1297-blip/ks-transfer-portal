-- TEST DATA: adds 36 fake prospects to the newest cycle whose name starts with "Transfer 9",
-- so you can see how the roster and dashboard look when full. Your existing prospects are not touched.
-- Every test row's notes start with "[TEST]" so they can be removed again (see the bottom of this file).
-- Run in the Supabase SQL Editor. Running it twice adds a second batch (use the cleanup first).

do $seed$
declare
  cid uuid;
  names text[] := array[
    'DragonSlayer88','NightBlade','SilverFox','IronWolf','StormRider','CrimsonKnight','FrostMage','ShadowHunter',
    'GoldenEagle','ThunderFist','BlazeKing','MoonWalker','SteelFang','AshenQueen','VoidWalker','RoyalGuard88',
    'WildFalcon','DarkPhoenix','IceBreaker','SunWarden','GrimReaper7','LionHeart','BattleBorn','StarForge',
    'RavenClaw','TitanFall','EmberLord','MysticOwl','WarHammer','SkyPiercer','BoneCrusher','GhostRider',
    'PrimeCommander','QuickSilver','OldGuard','BigBadWolf'];
  recruiters text[] := array['Aria','Dax','Mikko','Sol','Tane'];
  alliances text[] := array['[D86] DRAGONS','[W86] WIN','[A86] ApexPredators','[KTA] KiLLThemALL','[T86] GemstoneTavern','[ZZZ] Wanderers','[NMD] Nomads'];
  assigns text[] := array['OPEN','D86','W86','A86','KTA','T86'];
  invites text[] := array['Open','Special','Ordinary'];
  note_list text[] := array[
    'Talked in Discord, interested in a top-10 alliance.',
    'Wants to bring two friends along.',
    'Waiting on their kingdom to confirm transfer pass.',
    'Strong in KvK, wants a very active alliance. Asked about rally leaders, the daily schedule, and whether we run migrations as a group. Needs a reply before the end of the cycle.',
    'Prefers voice chat, evenings (UTC+8).',
    ''];
begin
  select c.id into cid from kstransfers.cycles c where c.name ilike 'Transfer 9%' order by c.created_at desc limit 1;
  if cid is null then raise exception 'No cycle named "Transfer 9..." found'; end if;

  insert into kstransfers.prospects
    (cycle_id, player_id, ign, kingdom, power, recruiter, status, alliance, truegold_grade, assigned_alliance, invite_type, notes, updated_at)
  select
    cid,
    (300000000 + i * 7919)::text,
    names[i],
    1000 + (i * 137) % 1000,
    25000000 + ((i * 37) % 230) * 1000000 + ((i * 13331) % 1000) * 1000,
    case when i % 7 = 0 then null else recruiters[1 + i % 5] end,
    (array['Not Contacted','Not Contacted','Not Contacted','In Talks','In Talks','In Talks','Considering','Considering','Committed','Committed','Rejected','Rejected'])[1 + i % 12],
    case when i % 8 = 0 then null else alliances[1 + i % 7] end,
    case when i % 11 = 0 then null else 'TG' || (1 + i % 5) end,
    case when i % 4 = 0 then null else assigns[1 + i % 6] end,
    case when i % 5 = 0 then null else invites[1 + i % 3] end,
    '[TEST] ' || note_list[1 + i % 6],
    now() - (i % 9) * interval '1 day' - ((i * 37) % 24) * interval '1 hour'
  from generate_series(1, 36) as i;
end $seed$;

-- =====================================================================
-- CLEANUP: run this to remove only the test prospects
-- (the audit log will record the additions and removals; that is expected)
-- =====================================================================
-- delete from kstransfers.prospects where notes like '[TEST]%';
