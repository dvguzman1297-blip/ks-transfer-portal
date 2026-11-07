'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { requestSummary } from '@/lib/requests';
import { fmtShort } from '@/lib/utils';
import { ListSkeleton } from './ui';

// The transfer requests board: "Incoming" (waiting for a decision) and "Past" (added or dismissed).
// Accepting a request turns it into a prospect (status "Not Contacted"). A request belongs to a cycle in one of three ways:
//   - it picked a cycle (cycle_id)
//   - it picked "next window" (after_date): it belongs to the earliest cycle that starts after that date,
//     which may not exist yet, in which case it waits until that cycle is created
//   - it was not sure: it goes into the cycle chosen in the selector at the top
export default function RequestsBoard({ notify, onCreateCycle }) {
  const [tab, setTab] = useState('incoming'); // 'incoming' | 'past'
  const [rows, setRows] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('transfer_requests').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('cycles').select('id,name,status,start_date,end_date').order('start_date', { ascending: false }),
    ]);
    setLoading(false);
    if (r.error) return notify(`Failed to load requests: ${r.error.message}`, 'err');
    setRows(r.data);
    if (!c.error) {
      setCycles(c.data);
      setCycleId((prev) => prev || c.data.find((x) => x.status === 'active')?.id || '');
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  // live: a new or changed request appears without refreshing
  useEffect(() => {
    const channel = supabase.channel('requests-board')
      .on('postgres_changes', { event: '*', schema: 'kstransfers', table: 'transfer_requests' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const activeCycles = cycles.filter((c) => c.status === 'active');

  // the cycle a request will be added to, or null while it is waiting for one to be created
  function target(r) {
    if (r.cycle_id) return cycles.find((c) => c.id === r.cycle_id) ?? null;
    if (r.after_date) {
      return cycles.filter((c) => c.start_date > r.after_date).sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;
    }
    return cycles.find((c) => c.id === cycleId) ?? null;
  }
  const groupKey = (r) => (r.after_date ? 'next' : r.cycle_id || 'unsure');

  async function setStatus(r, status) {
    const { error } = await supabase.from('transfer_requests').update({ status }).eq('id', r.id);
    if (error) throw error;
  }

  async function accept(r) {
    const t = target(r);
    if (!t) return notify(r.after_date ? 'Create the next cycle first' : 'Create an active transfer cycle first', 'err');
    setBusyId(r.id);
    try {
      const { error } = await supabase.from('prospects').insert({
        cycle_id: t.id, player_id: r.player_id, ign: r.ign, kingdom: r.kingdom, power: r.power,
        alliance: r.current_alliance, truegold_grade: r.truegold_grade, status: 'Not Contacted',
        notes: `Public request\n${requestSummary(r)}`.slice(0, 2000),
      });
      if (error) throw error;
      await setStatus(r, 'accepted');
      notify(`${r.ign} added to ${t.name}`);
    } catch (err) { notify(`Failed: ${err.message}`, 'err'); }
    setBusyId(null);
    load();
  }

  async function changeStatus(r, status, okMessage) {
    setBusyId(r.id);
    try { await setStatus(r, status); if (okMessage) notify(okMessage); } catch (err) {
      notify(err.code === '23505' ? 'That player already has a request waiting' : `Failed: ${err.message}`, 'err');
    }
    setBusyId(null);
    load();
  }

  const incoming = rows.filter((r) => r.status === 'new');
  const past = rows.filter((r) => r.status !== 'new');

  // filter chips (incoming only): one per cycle that has requests, then "Next window", then "Not sure"
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of incoming) {
      const key = groupKey(r);
      if (!map.has(key)) {
        const c = r.cycle_id ? cycles.find((x) => x.id === r.cycle_id) : null;
        map.set(key, { key, n: 0, label: key === 'next' ? 'Next window' : key === 'unsure' ? 'Not sure yet' : (c?.name || r.transfer_window), order: key === 'unsure' ? 3 : key === 'next' ? 2 : 1, start: c?.start_date || '' });
      }
      map.get(key).n++;
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.start.localeCompare(b.start));
  }, [incoming, cycles]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeFilter = groups.some((g) => g.key === filter) ? filter : 'all';
  const shown = activeFilter === 'all' ? incoming : incoming.filter((r) => groupKey(r) === activeFilter);

  const card = (r, actions) => {
    const t = r.after_date ? target(r) : null;
    return (
      <li key={r.id} className="card p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-100">{r.ign} <span className="text-sm font-normal text-slate-500">· ID {r.player_id}</span></div>
            <div className="text-xs text-slate-400">
              {r.kingdom ? `K${r.kingdom} · ` : ''}{fmtShort(r.power)} power{r.current_alliance ? ` · ${r.current_alliance}` : ''}{r.truegold_grade ? ` · ${r.truegold_grade}` : ''}
            </div>
          </div>
          <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div><dt className="inline text-slate-500">Passes: </dt><dd className="inline text-slate-200">{r.transfer_passes}</dd></div>
          <div>
            <dt className="inline text-slate-500">Window: </dt>
            <dd className="inline text-slate-200">{r.transfer_window}</dd>
            {r.after_date && (t
              ? <span className="ml-1 text-emerald-300">→ {t.name}</span>
              : <span className="ml-1 text-amber-300">· cycle not created yet</span>)}
          </div>
          <div className="sm:col-span-2"><dt className="inline text-slate-500">Looking for: </dt><dd className="inline text-slate-200">{r.looking_for}</dd></div>
          <div className="sm:col-span-2"><dt className="inline text-slate-500">Contact with 1886: </dt><dd className="inline text-slate-200">{r.contacted_1886 ? `Yes, ${r.contacted_who}` : 'No'}</dd></div>
          {r.contact_handle && <div className="sm:col-span-2"><dt className="inline text-slate-500">Reach them at: </dt><dd className="inline text-slate-200">{r.contact_handle}</dd></div>}
          {r.message && <div className="sm:col-span-2"><dt className="inline text-slate-500">Note: </dt><dd className="inline text-slate-200">{r.message}</dd></div>}
        </dl>
        {actions}
      </li>
    );
  };

  const tabs = [['incoming', 'Incoming transfers', incoming.length], ['past', 'Past transfers', past.length]];

  return (
    <div>
      <div role="tablist" aria-label="Transfer requests" className="mb-4 flex gap-1 border-b border-navy-600">
        {tabs.map(([key, label, n]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === key ? 'border-gold-400 text-gold-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${tab === key ? 'bg-gold-500 text-slate-950' : 'bg-navy-700 text-slate-300'}`}>{n}</span>
          </button>
        ))}
      </div>

      {loading ? <ListSkeleton rows={4} /> : tab === 'incoming' ? (
        <>
          {groups.length > 1 && (
            <div role="group" aria-label="Filter by transfer window" className="mb-3 flex flex-wrap gap-1.5">
              {[{ key: 'all', label: 'All', n: incoming.length }, ...groups].map((g) => (
                <button key={g.key} aria-pressed={activeFilter === g.key} onClick={() => setFilter(g.key)}
                  className={`btn-ghost px-3 py-1 text-xs ${activeFilter === g.key ? '!border-gold-400 !bg-gold-500/10' : ''}`}>
                  {g.label} <b className="ml-1 text-gold-300">{g.n}</b>
                </button>
              ))}
            </div>
          )}
          {activeCycles.length > 1 && groups.some((g) => g.key === 'unsure') && (
            <label className="mb-3 flex items-center gap-2 text-xs text-slate-400">
              Requests that are not sure which window go to
              <select className="input !w-auto" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                {activeCycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {!shown.length && <p className="card py-10 text-center text-sm text-slate-500">No incoming transfer requests.</p>}
          <ul className="space-y-3">
            {shown.map((r) => card(r, (
              <div className="mt-4 flex flex-wrap gap-2">
                {r.after_date && !target(r) ? (
                  <button className="btn-gold px-3 py-1.5" onClick={() => onCreateCycle?.()}>Create next cycle first</button>
                ) : (
                  <button className="btn-blue px-3 py-1.5" disabled={busyId === r.id} onClick={() => accept(r)}>Add to prospects</button>
                )}
                <button className="btn-ghost px-3 py-1.5" disabled={busyId === r.id} onClick={() => changeStatus(r, 'dismissed')}>Dismiss</button>
              </div>
            )))}
          </ul>
        </>
      ) : (
        <>
          {!past.length && <p className="card py-10 text-center text-sm text-slate-500">No past transfer requests yet. Requests you add or dismiss show up here.</p>}
          <ul className="space-y-3">
            {past.map((r) => card(r, (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${r.status === 'accepted' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-slate-500/50 bg-slate-500/10 text-slate-400'}`}>
                  {r.status === 'accepted' ? 'Added to prospects' : 'Dismissed'}
                </span>
                {r.status === 'dismissed' && (
                  <button className="btn-ghost px-3 py-1 text-xs" disabled={busyId === r.id} onClick={() => changeStatus(r, 'new', `${r.ign} moved back to incoming`)}>Move back to incoming</button>
                )}
              </div>
            )))}
          </ul>
        </>
      )}
    </div>
  );
}
