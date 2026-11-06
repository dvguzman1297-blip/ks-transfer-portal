'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Modal } from './ui';

const PAGE = 100;

const LABELS = {
  ign: 'IGN', player_id: 'Player ID', kingdom: 'Kingdom', power: 'Power', alliance: 'Current alliance',
  truegold_grade: 'TC level', assigned_alliance: 'Assigned to', invite_type: 'Invite type',
  recruiter: 'Recruiter', status: 'Status', notes: 'Notes', name: 'Name', start_date: 'Start date',
  end_date: 'End date', role: 'Role', display_name: 'Name', ordinary_slots: 'Ordinary invites', special_slots: 'Special invites', open_slots: 'Open slots', email: 'Email',
};
const HIDDEN = new Set(['id', 'user_id', 'approved_at', 'cycle_id', 'updated_at', 'created_at', 'target_kingdom', 'target_players', 'target_power', 'workspace_id']);

const TYPE_LABEL = { prospects: 'Prospect', cycles: 'Cycle', members: 'Member' };

const ACTION = {
  INSERT: { label: 'Created', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  UPDATE: { label: 'Edited', cls: 'border-sky-500/50 bg-sky-500/10 text-sky-300' },
  DELETE: { label: 'Deleted', cls: 'border-rose-500/50 bg-rose-500/10 text-rose-300' },
};

const fmtVal = (key, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'power' && !Number.isNaN(Number(v))) return Number(v).toLocaleString('en-US');
  return String(v);
};
const decodeActor = (a) => {
  if (!a) return null;
  try { return decodeURIComponent(a); } catch { return a; }
};
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const ago = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const fieldRows = (obj) =>
  Object.entries(obj || {})
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== '')
    .map(([k, v]) => [LABELS[k] || k, fmtVal(k, v)]);

function Entry({ e }) {
  const meta = ACTION[e.action];
  const isProspect = e.table_name === 'prospects';
  const kindLabel = TYPE_LABEL[e.table_name] || 'Cycle';
  const actor = decodeActor(e.actor);
  const data = e.action === 'DELETE' ? e.old_data : e.new_data;
  const changes = Object.entries(e.changed || {}).filter(([k]) => !HIDDEN.has(k));

  return (
    <li className="rounded-lg border border-navy-600 bg-navy-900/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.cls}`}>{meta.label}</span>
          <span className="text-xs uppercase text-slate-500">{kindLabel}</span>
          <b className="truncate text-slate-100">{e.summary || '—'}</b>
          {isProspect && e.cycle_name && <span className="text-xs text-slate-500">in {e.cycle_name}</span>}
        </div>
        <div className="text-right text-xs text-slate-400" title={e.at}>
          {when(e.at)} <span className="text-slate-600">· {ago(e.at)}</span>
        </div>
      </div>

      {e.action === 'UPDATE' && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {changes.map(([k, c]) => (
            <li key={k} className="text-slate-300">
              <span className="text-slate-500">{LABELS[k] || k}:</span>{' '}
              <span className="text-rose-300/80 line-through">{fmtVal(k, c.from)}</span>
              {' → '}
              <span className="font-semibold text-emerald-300">{fmtVal(k, c.to)}</span>
            </li>
          ))}
        </ul>
      )}

      {e.action !== 'UPDATE' && (
        <details className="mt-2" open={e.action === 'DELETE'}>
          <summary className="cursor-pointer text-xs text-gold-400">{e.action === 'DELETE' ? 'Deleted record' : 'Record details'}</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {fieldRows(data).map(([label, val]) => (
              <div key={label} className="flex gap-2">
                <dt className="shrink-0 text-slate-500">{label}:</dt>
                <dd className="min-w-0 break-words text-slate-200">{val}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className="mt-2 text-xs text-slate-500">By {actor ? <b className="text-slate-300">{actor}</b> : 'system / database'}</div>
    </li>
  );
}

const csvEsc = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function AuditLog({ onClose, notify, cycles = [], currentCycleId = '' }) {
  const [fCycle, setFCycle] = useState(currentCycleId); // '' = all cycles
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fTable, setFTable] = useState('');
  const [fAction, setFAction] = useState('');
  const [q, setQ] = useState('');

  const buildQuery = useCallback(() => {
    let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).order('id', { ascending: false });
    if (fTable) query = query.eq('table_name', fTable);
    if (fAction) query = query.eq('action', fAction);
    if (fCycle && fTable !== 'members') query = query.eq('cycle_id', fCycle); // member changes belong to no cycle
    return query;
  }, [fTable, fAction, fCycle]);

  const load = useCallback(async (offset) => {
    setLoading(true);
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
    setLoading(false);
    if (error) {
      setError(/audit_log/.test(error.message) ? 'The audit log table is missing. Run the latest schema.sql in Supabase.' : error.message);
      return;
    }
    setError('');
    setRows((prev) => (offset === 0 ? data : [...prev, ...data]));
    setHasMore(data.length === PAGE);
  }, [buildQuery]);

  useEffect(() => { load(0); }, [load]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((e) =>
        [e.summary, e.actor && decodeActor(e.actor), e.cycle_name, JSON.stringify(e.changed), JSON.stringify(e.old_data), JSON.stringify(e.new_data)]
          .join(' ').toLowerCase().includes(needle))
    : rows;

  async function exportCSV() {
    const all = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data, error } = await buildQuery().range(offset, offset + 999);
      if (error) return notify(error.message, 'err');
      all.push(...data);
      if (data.length < 1000) break;
    }
    if (!all.length) return notify('Nothing to export', 'err');
    const head = ['timestamp', 'actor', 'action', 'type', 'summary', 'cycle', 'changes', 'record'];
    const lines = all.map((e) => [
      e.at,
      decodeActor(e.actor) || '',
      ACTION[e.action].label,
      TYPE_LABEL[e.table_name] || 'Cycle',
      e.summary || '',
      e.cycle_name || '',
      Object.entries(e.changed || {}).filter(([k]) => !HIDDEN.has(k))
        .map(([k, c]) => `${LABELS[k] || k}: ${fmtVal(k, c.from)} -> ${fmtVal(k, c.to)}`).join('; '),
      e.action === 'UPDATE' ? '' : fieldRows(e.action === 'DELETE' ? e.old_data : e.new_data).map(([l, v]) => `${l}: ${v}`).join('; '),
    ].map(csvEsc).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal title="Audit Log" onClose={onClose} wide>
      <p className="mb-3 text-xs text-slate-400">
        Every addition, edit and deletion is recorded automatically by the database and can&apos;t be changed from the app.
        Each entry shows the verified email of the person who made the change.
      </p>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input className="input min-w-0 sm:flex-1" placeholder="🔎 Search player, person, change…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input sm:w-48 sm:shrink-0" value={fCycle} onChange={(e) => setFCycle(e.target.value)} aria-label="Cycle">
          <option value="">All cycles</option>
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input sm:w-36 sm:shrink-0" value={fTable} onChange={(e) => setFTable(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="prospects">Prospects</option>
          <option value="cycles">Cycles</option>
          <option value="members">Members</option>
        </select>
        <select className="input sm:w-36 sm:shrink-0" value={fAction} onChange={(e) => setFAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          <option value="INSERT">Created</option>
          <option value="UPDATE">Edited</option>
          <option value="DELETE">Deleted</option>
        </select>
        <button className="btn-ghost shrink-0" onClick={() => load(0)}>↻ Refresh</button>
        <button className="btn-ghost shrink-0" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {error && <p className="mb-3 rounded-lg border border-rose-500 bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}

      <ul className="space-y-2">
        {shown.map((e) => <Entry key={e.id} e={e} />)}
      </ul>

      {!loading && !error && !shown.length && (
        <p className="py-8 text-center text-sm text-slate-500">{rows.length ? 'No entries match your search.' : 'No activity recorded yet.'}</p>
      )}
      {loading && <p className="py-4 text-center text-sm text-slate-500">Loading…</p>}
      {hasMore && !loading && (
        <button className="btn-ghost mt-3 w-full" onClick={() => load(rows.length)}>Load older entries</button>
      )}
    </Modal>
  );
}
