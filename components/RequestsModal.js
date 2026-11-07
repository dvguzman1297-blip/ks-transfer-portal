'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { requestSummary } from '@/lib/requests';
import { fmtShort } from '@/lib/utils';
import { ListSkeleton, Modal } from './ui';

// Inbox of public transfer requests. Accepting one turns it into a prospect (status "Not Contacted").
export default function RequestsModal({ notify, onClose, onChanged, onAccepted }) {
  const [rows, setRows] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('transfer_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('cycles').select('id,name,status').eq('status', 'active').order('created_at', { ascending: false }),
    ]);
    setLoading(false);
    if (r.error) return notify(`Failed to load requests: ${r.error.message}`, 'err');
    setRows(r.data);
    if (!c.error) { setCycles(c.data); setCycleId((prev) => prev || c.data[0]?.id || ''); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(r, status) {
    const { error } = await supabase.from('transfer_requests').update({ status }).eq('id', r.id);
    if (error) throw error;
  }

  async function accept(r) {
    if (!cycleId) return notify('Create an active transfer cycle first', 'err');
    setBusyId(r.id);
    try {
      const { error } = await supabase.from('prospects').insert({
        cycle_id: cycleId, player_id: r.player_id, ign: r.ign, kingdom: r.kingdom, power: r.power,
        alliance: r.current_alliance, truegold_grade: r.truegold_grade, status: 'Not Contacted',
        notes: `Public request\n${requestSummary(r)}`.slice(0, 2000),
      });
      if (error) throw error;
      await setStatus(r, 'accepted');
      notify(`${r.ign} added to prospects`);
      onAccepted?.();
    } catch (err) { notify(`Failed: ${err.message}`, 'err'); }
    setBusyId(null);
    load(); onChanged?.();
  }

  async function dismiss(r) {
    setBusyId(r.id);
    try { await setStatus(r, 'dismissed'); } catch (err) { notify(`Failed: ${err.message}`, 'err'); }
    setBusyId(null);
    load(); onChanged?.();
  }

  const fresh = rows.filter((r) => r.status === 'new');
  const done = rows.filter((r) => r.status !== 'new');

  const card = (r, actions) => (
    <li key={r.id} className="rounded-lg border border-navy-600 bg-navy-900/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-100">{r.ign} <span className="font-normal text-slate-500">· ID {r.player_id}</span></div>
          <div className="text-xs text-slate-400">
            {r.kingdom ? `K${r.kingdom} · ` : ''}{fmtShort(r.power)} power{r.current_alliance ? ` · ${r.current_alliance}` : ''}{r.truegold_grade ? ` · ${r.truegold_grade}` : ''}
          </div>
        </div>
        <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
        <div><dt className="inline text-slate-500">Passes: </dt><dd className="inline text-slate-200">{r.transfer_passes}</dd></div>
        <div><dt className="inline text-slate-500">Window: </dt><dd className="inline text-slate-200">{r.transfer_window}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-slate-500">Looking for: </dt><dd className="inline text-slate-200">{r.looking_for}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-slate-500">Contact with 1886: </dt><dd className="inline text-slate-200">{r.contacted_1886 ? `Yes, ${r.contacted_who}` : 'No'}</dd></div>
        {r.contact_handle && <div className="sm:col-span-2"><dt className="inline text-slate-500">Reach them at: </dt><dd className="inline text-slate-200">{r.contact_handle}</dd></div>}
        {r.message && <div className="sm:col-span-2"><dt className="inline text-slate-500">Note: </dt><dd className="inline text-slate-200">{r.message}</dd></div>}
      </dl>
      {actions}
    </li>
  );

  return (
    <Modal title="Transfer requests" onClose={onClose}>
      {loading ? <ListSkeleton rows={3} /> : (
        <>
          {cycles.length > 1 && (
            <label className="mb-3 flex items-center gap-2 text-xs text-slate-400">
              Add accepted requests to
              <select className="input !w-auto" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {!fresh.length && <p className="py-6 text-center text-sm text-slate-500">No new requests.</p>}
          <ul className="space-y-2">
            {fresh.map((r) => card(r, (
              <div className="mt-3 flex gap-2">
                <button className="btn-blue px-3 py-1.5" disabled={busyId === r.id} onClick={() => accept(r)}>Add to prospects</button>
                <button className="btn-ghost px-3 py-1.5" disabled={busyId === r.id} onClick={() => dismiss(r)}>Dismiss</button>
              </div>
            )))}
          </ul>
          {done.length > 0 && (
            <div className="mt-4">
              <button className="text-xs text-gold-400 underline" onClick={() => setShowDone((s) => !s)}>
                {showDone ? 'Hide' : 'Show'} handled requests ({done.length})
              </button>
              {showDone && (
                <ul className="mt-2 space-y-2 opacity-70">
                  {done.map((r) => card(r, <p className="mt-2 text-xs font-semibold uppercase text-slate-400">{r.status}</p>))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
