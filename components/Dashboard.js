'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AuditLog from './AuditLog';
import { Combobox, Modal } from './ui';
import {
  INVITE_TYPES, STATUSES, STALE_DAYS, MAX_IMPORT_BYTES, CSV_COLS,
  isFollowUp, isUnassigned, freshCycle, rangeLabel, cycleCountdown,
  fmt, parsePower, digits, fmtShort, toCSV, parseCSV, normalizeImportRows,
} from '@/lib/utils';

// Alliances prospects can be assigned to (stored as the tag). Edit this list as alliances change.
const ALLIANCES = [
  { tag: 'OPEN', name: '' },
  { tag: 'D86', name: 'DRAGONS' },
  { tag: 'W86', name: 'WIN' },
  { tag: 'A86', name: 'ApexPredators' },
  { tag: 'KTA', name: 'KiLLThemALL' },
  { tag: 'T86', name: 'GemstoneTavern' },
];
const INVITE_STYLE = {
  Open: 'text-emerald-300',
  Special: 'text-fuchsia-300',
  Ordinary: 'text-slate-300',
};
const STATUS_STYLE = {
  'Not Contacted': 'text-slate-300 border-slate-500/50 bg-slate-500/10',
  'In Talks': 'text-sky-300 border-sky-500/50 bg-sky-500/10',
  Considering: 'text-amber-300 border-amber-500/50 bg-amber-500/10',
  Committed: 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10',
  Rejected: 'text-rose-300 border-rose-500/50 bg-rose-500/10',
};
const STATUS_ICON = { 'Not Contacted': '○', 'In Talks': '◔', Considering: '◑', Committed: '✔', Rejected: '✕' };
const STAGE_BAR = {
  'Not Contacted': 'bg-slate-500',
  'In Talks': 'bg-sky-500',
  Considering: 'bg-amber-500',
  Committed: 'bg-emerald-500',
  Rejected: 'bg-rose-500',
};

const EMPTY_FORM = {
  player_id: '', ign: '', kingdom: '', power: '',
  recruiter: '', status: STATUSES[0], notes: '', alliance: '', truegold_grade: '', assigned_alliance: '', invite_type: '',
};

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Small components ---------- */
function StatusBadge({ status }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[status] || ''}`}>{status}</span>;
}


function Stat({ label, value, sub, accent }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${accent || 'text-gold-400'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/* ---------- Page ---------- */
export default function Dashboard({ headerExtra = null, headerEnd = null }) {
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState('');
  const [prospects, setProspects] = useState([]);
  const [cycleStats, setCycleStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);

  const [showCycles, setShowCycles] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [newCycle, setNewCycle] = useState(freshCycle);
  const [showNewCycle, setShowNewCycle] = useState(false);

  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState(''); // '' | 'followup' | 'unassigned'
  const [dateEdit, setDateEdit] = useState(null); // { id, name, start, end }
  const [fStatus, setFStatus] = useState('');
  const [fAssigned, setFAssigned] = useState('');
  const [fRecruiter, setFRecruiter] = useState('');
  const [sort, setSort] = useState({ key: 'power', dir: 'desc' });
  const fileRef = useRef(null);

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const currentCycle = cycles.find((c) => c.id === cycleId);

  /* ----- data loading ----- */
  const loadCycles = useCallback(async (selectId) => {
    const { data, error } = await supabase.from('cycles').select('*').order('created_at', { ascending: false });
    if (error) { notify(`Failed to load cycles: ${error.message}`, 'err'); setLoading(false); return; }
    setCycles(data);
    setCycleId((prev) => {
      if (selectId) return selectId;
      if (prev && data.some((c) => c.id === prev)) return prev;
      return (data.find((c) => c.status === 'active') || data[0])?.id || '';
    });
    setLoading(false);
  }, [notify]);

  const loadProspects = useCallback(async (id) => {
    if (!id) { setProspects([]); return; }
    const { data, error } = await supabase.from('prospects').select('*').eq('cycle_id', id);
    if (error) notify(`Failed to load prospects: ${error.message}`, 'err');
    else setProspects(data);
  }, [notify]);

  const loadStats = useCallback(async () => {
    const { data, error } = await supabase.from('prospects').select('cycle_id,status,power');
    if (error) return;
    const s = {};
    for (const p of data) {
      const o = (s[p.cycle_id] ||= { total: 0, committed: 0, power: 0 });
      o.total++;
      if (p.status === 'Committed') { o.committed++; o.power += Number(p.power) || 0; }
    }
    setCycleStats(s);
  }, []);

  useEffect(() => { loadCycles(); }, [loadCycles]);

  useEffect(() => { loadProspects(cycleId); }, [cycleId, loadProspects]);
  useEffect(() => { if (showCycles) loadStats(); }, [showCycles, loadStats]);

  /* ----- cycles ----- */
  async function createCycle(e) {
    e.preventDefault();
    if (!newCycle.name.trim()) return;
    const { data, error } = await supabase.from('cycles').insert({
      name: newCycle.name.trim(),
      start_date: newCycle.start_date,
      end_date: newCycle.end_date || null,
      status: 'active',
    }).select().single();
    if (error) return notify(error.message, 'err');
    setNewCycle(freshCycle());
    setShowNewCycle(false);
    await loadCycles(data.id);
    loadStats();
    notify('Cycle created');
  }

  async function saveDates(e) {
    e?.preventDefault();
    if (!dateEdit.name.trim()) return notify('Cycle name cannot be empty', 'err');
    const { error } = await supabase.from('cycles').update({
      name: dateEdit.name.trim(),
      start_date: dateEdit.start,
      end_date: dateEdit.end || null,
    }).eq('id', dateEdit.id);
    if (error) return notify(error.message, 'err');
    setDateEdit(null);
    await loadCycles();
    notify('Cycle updated');
  }

  async function deleteCycle(c) {
    const n = cycleStats[c.id]?.total ?? 0;
    if (!confirm(`Delete "${c.name}"${n ? ` and its ${n} prospect${n === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    const { error } = await supabase.from('cycles').delete().eq('id', c.id);
    if (error) return notify(error.message, 'err');
    if (dateEdit?.id === c.id) setDateEdit(null);
    await loadCycles();
    loadStats();
    notify('Cycle deleted');
  }

  async function toggleArchive(c) {
    const status = c.status === 'active' ? 'archived' : 'active';
    const { error } = await supabase.from('cycles').update({ status }).eq('id', c.id);
    if (error) return notify(error.message, 'err');
    await loadCycles();
  }

  /* ----- lookup ----- */
  async function autoLookup() {
    if (!form.player_id.trim()) return notify('Enter a Player ID first', 'err');
    setLooking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ playerId: form.player_id.trim() }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Lookup failed');
      const d = j.data || {};
      setForm((f) => ({
        ...f,
        ign: d.ign || f.ign,
        kingdom: d.kingdom ? String(d.kingdom) : f.kingdom,
        power: d.power ? fmt(parsePower(d.power)) : f.power,
        alliance: d.alliance || f.alliance,
        truegold_grade: d.truegoldGrade || f.truegold_grade,
      }));
      notify(`Found ${d.ign}${d.kingdom ? ` (Kingdom ${d.kingdom})` : ''}`);
    } catch (err) {
      notify(`${err.message}. You can enter details manually.`, 'err');
    } finally {
      setLooking(false);
    }
  }

  /* ----- prospects CRUD ----- */
  async function saveProspect(e) {
    e.preventDefault();
    if (!cycleId) return notify('Create a transfer cycle first', 'err');
    if (!form.player_id.trim() || !form.ign.trim()) return notify('Player ID and IGN are required', 'err');
    setSaving(true);
    const row = {
      cycle_id: cycleId,
      player_id: form.player_id.trim(),
      ign: form.ign.trim(),
      kingdom: form.kingdom ? parseInt(form.kingdom, 10) : null,
      power: parsePower(form.power),
      recruiter: form.recruiter.trim() || null,
      alliance: form.alliance.trim() || null,
      truegold_grade: form.truegold_grade.trim() || null,
      assigned_alliance: form.assigned_alliance.trim() || null,
      invite_type: form.invite_type || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };
    const q = editingId
      ? supabase.from('prospects').update(row).eq('id', editingId)
      : supabase.from('prospects').insert(row);
    const { error } = await q;
    setSaving(false);
    if (error) return notify(error.message, 'err');
    notify(editingId ? 'Prospect updated' : 'Prospect added');
    closeForm();
    loadProspects(cycleId);
  }

  async function updateField(p, field, value) {
    const v = value || null;
    setProspects((list) => list.map((x) => (x.id === p.id ? { ...x, [field]: v } : x)));
    const { error } = await supabase.from('prospects').update({ [field]: v }).eq('id', p.id);
    if (error) { notify(error.message, 'err'); loadProspects(cycleId); }
  }

  async function updateStatus(p, status) {
    setProspects((list) => list.map((x) => (x.id === p.id ? { ...x, status } : x)));
    const { error } = await supabase.from('prospects').update({ status }).eq('id', p.id);
    if (error) { notify(error.message, 'err'); loadProspects(cycleId); }
  }

  async function deleteProspect(p) {
    if (!confirm(`Delete ${p.ign}?`)) return;
    const { error } = await supabase.from('prospects').delete().eq('id', p.id);
    if (error) return notify(error.message, 'err');
    setProspects((list) => list.filter((x) => x.id !== p.id));
  }

  function closeForm() { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }
  function openAdd() { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }

  function editProspect(p) {
    setEditingId(p.id);
    setShowForm(true);
    setForm({
      player_id: p.player_id, ign: p.ign, kingdom: p.kingdom ?? '', power: fmt(p.power),
      recruiter: p.recruiter || '', status: p.status, notes: p.notes || '',
      alliance: p.alliance || '', truegold_grade: p.truegold_grade || '', assigned_alliance: p.assigned_alliance || '', invite_type: p.invite_type || '',
    });
  }

  /* ----- import / export ----- */
  function exportCSV() {
    if (!prospects.length) return notify('Nothing to export', 'err');
    const name = (currentCycle?.name || 'cycle').replace(/[^\w-]+/g, '_');
    download(`${name}_prospects.csv`, toCSV(prospects), 'text/csv;charset=utf-8');
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!cycleId) return notify('Select a cycle before importing', 'err');
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('File is too large (max 2 MB)');
      const text = await file.text();
      let raw;
      if (file.name.toLowerCase().endsWith('.json')) {
        const j = JSON.parse(text);
        raw = Array.isArray(j) ? j : j.prospects;
        if (!Array.isArray(raw)) throw new Error('JSON must be an array of prospects');
      } else raw = parseCSV(text);

      const rows = normalizeImportRows(raw, cycleId);

      if (!rows.length) throw new Error('No valid rows found (player_id and ign are required)');
      if (!confirm(`Import ${rows.length} prospects into "${currentCycle?.name}"?`)) return;
      const { error } = await supabase.from('prospects').insert(rows);
      if (error) throw new Error(error.message);
      notify(`Imported ${rows.length} prospects`);
      loadProspects(cycleId);
    } catch (err) {
      notify(`Import failed: ${err.message}`, 'err');
    }
  }

  /* ----- derived ----- */
  const assignedAlliances = useMemo(() => [...new Set(prospects.map((p) => p.assigned_alliance).filter(Boolean))].sort(), [prospects]);
  const allianceOptions = useMemo(() => {
    const known = ALLIANCES.map((a) => ({ value: a.tag, label: a.tag }));
    const knownTags = new Set(ALLIANCES.map((a) => a.tag.toLowerCase()));
    const custom = assignedAlliances.filter((a) => !knownTags.has(a.toLowerCase())).map((a) => ({ value: a, label: a, hint: 'used before' }));
    return [...known, ...custom];
  }, [assignedAlliances]);
  const recruiters = useMemo(() => [...new Set(prospects.map((p) => p.recruiter).filter(Boolean))].sort(), [prospects]);

  const summary = useMemo(() => {
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    let power = 0, followUp = 0, unassigned = 0;
    const staleBefore = Date.now() - STALE_DAYS * 86400000;
    for (const p of prospects) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      if (p.status === 'Committed') {
        power += Number(p.power) || 0;
      }
      if (isFollowUp(p, staleBefore)) followUp++;
      if (isUnassigned(p)) unassigned++;
    }
    const committed = byStatus.Committed;
    return { byStatus, power, committed, avg: committed ? Math.round(power / committed) : 0, followUp, unassigned };
  }, [prospects]);

  const countdown = useMemo(() => cycleCountdown(currentCycle), [currentCycle]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const staleBefore = Date.now() - STALE_DAYS * 86400000;
    const list = prospects.filter((p) => {
      if (quick === 'followup' && !isFollowUp(p, staleBefore)) return false;
      if (quick === 'unassigned' && !isUnassigned(p)) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fAssigned && (fAssigned === '__none' ? p.assigned_alliance : p.assigned_alliance !== fAssigned)) return false;
      if (fRecruiter && p.recruiter !== fRecruiter) return false;
      if (!q) return true;
      return [p.ign, p.player_id, p.kingdom, p.recruiter, p.status, p.alliance, p.truegold_grade, p.assigned_alliance, p.invite_type, p.notes]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = a[key], y = b[key];
      if (key === 'power' || key === 'kingdom') return ((Number(x) || 0) - (Number(y) || 0)) * mul;
      return String(x ?? '').localeCompare(String(y ?? ''), undefined, { sensitivity: 'base' }) * mul;
    });
  }, [prospects, search, fStatus, fAssigned, fRecruiter, quick, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'power' ? 'desc' : 'asc' }));

  const Th = ({ k, children, className = '' }) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gold-400 hover:text-gold-300 ${className}`} onClick={() => toggleSort(k)}>
      {children} {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  const clearFilters = () => { setSearch(''); setFStatus(''); setFAssigned(''); setFRecruiter(''); setQuick(''); };
  const filtersActive = search || fStatus || fAssigned || fRecruiter || quick;

  /* ---------- render ---------- */
  const activeCycles = cycles.filter((c) => c.status === 'active').sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const archivedCycles = cycles.filter((c) => c.status !== 'active').sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));

  const renderCycle = (c) => {
    const s = cycleStats[c.id] || { total: 0, committed: 0, power: 0 };
    const isOpen = c.id === cycleId;
    const archived = c.status !== 'active';
    return (
      <div key={c.id} className={`rounded-lg border border-l-4 p-3 ${isOpen ? 'border-gold-500 bg-gold-500/5' : 'border-navy-600 bg-navy-900/60'} ${archived ? 'border-l-slate-500' : 'border-l-emerald-500'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-bold text-slate-100">{c.name}</span>
              {isOpen && <span className="rounded-full border border-gold-500/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-gold-300">Open</span>}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${archived ? 'border-slate-500/50 text-slate-400' : 'border-emerald-500/50 text-emerald-300'}`}>{c.status}</span>
            </div>
            <div className="mt-0.5 text-xs text-slate-400">{rangeLabel(c.start_date, c.end_date)}</div>
          </div>
          <div className="flex gap-x-4 gap-y-1 text-xs text-slate-400">
            <span><b className="text-slate-100">{s.total}</b> prospects</span>
            <span><b className="text-emerald-400">{s.committed}</b> committed</span>
            <span title={fmt(s.power)}><b className="text-gold-400">{fmtShort(s.power)}</b> power</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-blue px-3 py-1.5" disabled={isOpen} onClick={() => { setCycleId(c.id); setShowCycles(false); }}>{isOpen ? '✓ Viewing' : 'Open'}</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => setDateEdit(dateEdit?.id === c.id ? null : { id: c.id, name: c.name, start: c.start_date, end: c.end_date ?? '' })}>✎ Edit</button>
          <button className="btn-ghost px-3 py-1.5" onClick={() => toggleArchive(c)}>{archived ? 'Reactivate' : 'Archive'}</button>
          <button className="btn-ghost ml-auto px-3 py-1.5 text-rose-300 hover:border-rose-500/60" onClick={() => deleteCycle(c)} aria-label={`Delete ${c.name}`}>🗑 Delete</button>
        </div>

        {dateEdit?.id === c.id && (
          <form onSubmit={saveDates} className="mt-3 grid grid-cols-1 gap-2 border-t border-navy-700 pt-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className="label">Cycle name</label>
              <input className="input" autoFocus maxLength={80} value={dateEdit.name} onChange={(e) => setDateEdit({ ...dateEdit, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Start date</label>
              <input type="date" required className="input" value={dateEdit.start} onClick={(e) => e.currentTarget.showPicker?.()}
                onChange={(e) => setDateEdit({ ...dateEdit, start: e.target.value, end: dateEdit.end && dateEdit.end < e.target.value ? '' : dateEdit.end })} />
            </div>
            <div>
              <label className="label">End date</label>
              <input type="date" className="input" value={dateEdit.end} min={dateEdit.start} onClick={(e) => e.currentTarget.showPicker?.()} onChange={(e) => setDateEdit({ ...dateEdit, end: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-gold flex-1">Save</button>
              <button type="button" className="btn-ghost" onClick={() => setDateEdit(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto w-full max-w-[1800px] px-3 py-4 sm:px-6 sm:py-6 2xl:px-10">
      {/* Header */}
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="K1886 Kingdom HQ crest" className="h-9 w-9 shrink-0 object-contain" />
          <div>
            <h1 className="bg-gradient-to-r from-gold-300 via-gold-500 to-gold-600 bg-clip-text text-2xl font-black tracking-wide text-transparent sm:text-3xl">
              K1886 TRANSFER PORTAL
            </h1>
            <p className="text-xs text-slate-400">Kingdom transfer prospect tracker</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input sm:w-64" value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="Transfer cycle">
            {!cycles.length && <option value="">No cycles yet</option>}
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.status === 'archived' ? '📁 ' : '● '}{c.name}
              </option>
            ))}
          </select>
          {headerExtra}
          <button className="btn-ghost shrink-0" onClick={() => setShowAudit(true)}>📜 Audit Log</button>
          <button className="btn-gold shrink-0" onClick={() => setShowCycles(true)}>Manage Cycles</button>
          {headerEnd}
        </div>
      </header>

      {loading ? (
        <p className="py-20 text-center text-slate-400">Loading…</p>
      ) : !cycles.length ? (
        <div className="card mx-auto max-w-md p-6 text-center">
          <p className="mb-4 text-slate-300">No transfer cycles yet. Create your first one to start tracking prospects.</p>
          <button className="btn-blue" onClick={() => setShowCycles(true)}>Create Transfer Cycle</button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="contents">
              <div className="card order-1 flex flex-col p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gold-400">Committed Transfers</h2>
                  {currentCycle?.status === 'archived' && <span className="text-xs text-slate-500">Archived cycle</span>}
                </div>
                <div className="grid flex-1 grid-cols-3 content-center gap-3 py-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Players</div>
                    <div className="text-4xl font-extrabold text-emerald-400">{summary.committed}</div>
                  </div>
                  <div title={fmt(summary.power)}>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Power</div>
                    <div className="text-4xl font-extrabold text-gold-400">{fmtShort(summary.power)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Avg / player</div>
                    <div className="text-4xl font-extrabold text-slate-200">{summary.avg ? fmtShort(summary.avg) : '—'}</div>
                  </div>
                </div>
                <div className="mt-2 border-t border-navy-700 pt-3 text-xs text-slate-400">
                  Total committed power <b className="ml-1 text-gold-300">{fmt(summary.power) || 0}</b>
                </div>
              </div>
              <div className="contents">
                <div className="card order-3 flex flex-col justify-center p-3 sm:p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Cycle clock</div>
                  <div className={`mt-1 text-2xl font-extrabold ${countdown?.tone}`}>{countdown?.big}</div>
                  <div className="text-xs text-slate-400">{countdown?.sub}</div>
                </div>
                <div className="card order-4 flex flex-col justify-center p-3 sm:p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400">Needs attention</div>
                  <div className="mt-2 flex flex-col gap-1.5 text-sm">
                    <button onClick={() => setQuick(quick === 'followup' ? '' : 'followup')}
                      className={`flex items-center justify-between rounded-lg border px-2 py-1 text-left ${quick === 'followup' ? 'border-gold-400 bg-gold-500/10' : 'border-navy-600'}`}>
                      <span>Follow up <span className="text-xs text-slate-500">({STALE_DAYS}d+ idle)</span></span>
                      <b className={summary.followUp ? 'text-amber-300' : 'text-slate-500'}>{summary.followUp}</b>
                    </button>
                    <button onClick={() => setQuick(quick === 'unassigned' ? '' : 'unassigned')}
                      className={`flex items-center justify-between rounded-lg border px-2 py-1 text-left ${quick === 'unassigned' ? 'border-gold-400 bg-gold-500/10' : 'border-navy-600'}`}>
                      <span>No recruiter</span>
                      <b className={summary.unassigned ? 'text-amber-300' : 'text-slate-500'}>{summary.unassigned}</b>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card order-2 flex flex-col p-3 sm:p-4">
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                <span>Pipeline · {prospects.length} prospect{prospects.length === 1 ? '' : 's'}</span>
                {fStatus && <button className="normal-case text-gold-400 underline" onClick={() => setFStatus('')}>Show all</button>}
              </div>
              <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-navy-900">
                {STATUSES.map((s) => summary.byStatus[s] > 0 && (
                  <div key={s} title={`${s}: ${summary.byStatus[s]}`} className={STAGE_BAR[s]} style={{ width: `${(summary.byStatus[s] / prospects.length) * 100}%` }} />
                ))}
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {STATUSES.map((s) => (
                  <button key={s} onClick={() => setFStatus(fStatus === s ? '' : s)}
                    className={`flex flex-col justify-between rounded-lg border px-3 py-2 text-left text-xs ${STATUS_STYLE[s]} ${fStatus === s ? 'ring-2 ring-gold-400' : ''}`}>
                    <div>{STATUS_ICON[s]} {s}</div>
                    <div>
                      <div className="text-3xl font-extrabold leading-none">{summary.byStatus[s]}</div>
                      <div className="mt-1 text-[10px] opacity-70">{prospects.length ? Math.round((summary.byStatus[s] / prospects.length) * 100) : 0}%</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Roster */}
          <section className="card p-3 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-lg font-bold text-gold-400">Prospect Roster <span className="text-sm font-normal text-slate-400">({visible.length}/{prospects.length})</span></h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn-blue" onClick={openAdd}>+ Add Prospect</button>
                <button className="btn-ghost" onClick={exportCSV}>⬇ Export Cycle to CSV</button>
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Import JSON/CSV</button>
                <input ref={fileRef} type="file" accept=".json,.csv,text/csv,application/json" className="hidden" onChange={importFile} />
              </div>
            </div>

            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <input className="input min-w-0 sm:flex-1" placeholder="🔎 Search name, ID, kingdom, alliance, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="input sm:w-44 sm:shrink-0" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className="input sm:w-48 sm:shrink-0" value={fAssigned} onChange={(e) => setFAssigned(e.target.value)}>
                <option value="">All assignments</option>
                <option value="__none">Unassigned</option>
                {assignedAlliances.map((a) => <option key={a}>{a}</option>)}
              </select>
              <select className="input sm:w-44 sm:shrink-0" value={fRecruiter} onChange={(e) => setFRecruiter(e.target.value)}>
                <option value="">All recruiters</option>{recruiters.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            {filtersActive && <button className="mb-3 text-xs text-gold-400 underline" onClick={clearFilters}>Clear filters</button>}

            <div className="overflow-x-auto rounded-lg border border-navy-600">
              <table className="min-w-full text-sm">
                <thead className="bg-navy-900">
                  <tr>
                    <Th k="ign">IGN</Th><Th k="player_id">ID</Th><Th k="kingdom">KINGDOM</Th>
                    <Th k="power">Power</Th><Th k="alliance">Alliance</Th><Th k="truegold_grade">TC</Th><Th k="recruiter">Recruiter</Th><Th k="assigned_alliance">Assigned To</Th><Th k="invite_type">Invite</Th>
                    <Th k="status">Status</Th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gold-400">Notes</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-700">
                  {visible.map((p) => (
                    <tr key={p.id} tabIndex={0} role="button" aria-label={`View details for ${p.ign}`}
                      className="cursor-pointer hover:bg-navy-700/40 focus:bg-navy-700/40 focus:outline-none"
                      onClick={() => editProspect(p)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editProspect(p); } }}>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-100">{p.ign}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{p.player_id}</td>
                      <td className="px-3 py-2">{p.kingdom ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gold-300">{fmt(p.power)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{p.alliance || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gold-300">{p.truegold_grade || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{p.recruiter || '—'}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select value={p.assigned_alliance || ''} onChange={(e) => updateField(p, 'assigned_alliance', e.target.value)}
                          aria-label={`Assigned alliance for ${p.ign}`}
                          className="rounded-full border border-sky-500/40 bg-navy-900 px-2 py-1 text-xs font-semibold text-sky-300 outline-none">
                          <option value="" className="bg-navy-900 text-slate-400">—</option>
                          {(allianceOptions.some((o) => o.value === p.assigned_alliance) || !p.assigned_alliance
                            ? allianceOptions
                            : [...allianceOptions, { value: p.assigned_alliance, label: p.assigned_alliance }]
                          ).map((o) => <option key={o.value} value={o.value} className="bg-navy-900 text-slate-100">{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select value={p.invite_type || ''} onChange={(e) => updateField(p, 'invite_type', e.target.value)}
                          aria-label={`Invite type for ${p.ign}`}
                          className={`rounded-full border border-navy-600 bg-navy-900 px-2 py-1 text-xs outline-none ${INVITE_STYLE[p.invite_type] || 'text-slate-500'}`}>
                          <option value="" className="bg-navy-900 text-slate-400">—</option>
                          {INVITE_TYPES.map((t) => <option key={t} value={t} className="bg-navy-900 text-slate-100">{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select value={p.status} onChange={(e) => updateStatus(p, e.target.value)}
                          className={`rounded-full border bg-navy-900 px-2 py-1 text-xs outline-none ${STATUS_STYLE[p.status]}`}>
                          {STATUSES.map((s) => <option key={s} className="bg-navy-900 text-slate-100">{s}</option>)}
                        </select>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-slate-400" title={p.notes || ''}>{p.notes}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <button className="px-1 text-rose-400 hover:text-rose-300" onClick={() => deleteProspect(p)} aria-label="Delete">🗑</button>
                      </td>
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr><td colSpan={12} className="px-3 py-10 text-center text-slate-500">
                      {prospects.length ? 'No prospects match your filters.' : 'No prospects in this cycle yet.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Form */}
          {showForm && (
          <Modal wide title={editingId ? 'Prospect Details' : 'Add Prospect'} onClose={closeForm}>
            <form onSubmit={saveProspect} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <h3 className="border-b border-navy-700 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:col-span-2 lg:col-span-4">Player</h3>
              <div className="sm:col-span-2">
                <label className="label">Player ID</label>
                <div className="flex gap-2">
                  <input className="input" inputMode="numeric" placeholder="e.g. 12345678" maxLength={20} value={form.player_id}
                    onChange={(e) => setForm({ ...form, player_id: digits(e.target.value) })} />
                  <button type="button" className="btn-blue shrink-0" onClick={autoLookup} disabled={looking}>
                    {looking ? 'Looking…' : '🔍 Auto Lookup'}
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="label">IGN</label>
                <input className="input" maxLength={60} value={form.ign} onChange={(e) => setForm({ ...form, ign: e.target.value })} />
              </div>
              <div>
                <label className="label">Current Kingdom</label>
                <input className="input" inputMode="numeric" maxLength={5} value={form.kingdom} onChange={(e) => setForm({ ...form, kingdom: digits(e.target.value) })} />
              </div>
              <div>
                <label className="label">Total Power</label>
                <input className="input" placeholder="120,500,000 or 153.8M" value={form.power}
                  onChange={(e) => setForm({ ...form, power: e.target.value.replace(/[^\d.,kmbKMB]/g, '') })}
                  onBlur={() => form.power && setForm((f) => ({ ...f, power: fmt(parsePower(f.power)) }))} />
              </div>
              <div>
                <label className="label">Current Alliance</label>
                <input className="input" placeholder="[TAG] Name" maxLength={80} value={form.alliance} onChange={(e) => setForm({ ...form, alliance: e.target.value })} />
              </div>
              <div>
                <label className="label">TC Level</label>
                <input className="input" placeholder="TG3" maxLength={20} value={form.truegold_grade} onChange={(e) => setForm({ ...form, truegold_grade: e.target.value })} />
              </div>

              <h3 className="mt-1 border-b border-navy-700 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:col-span-2 lg:col-span-4">Recruitment</h3>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Invite type</label>
                <select className="input" value={form.invite_type} onChange={(e) => setForm({ ...form, invite_type: e.target.value })}>
                  <option value="">Select…</option>
                  {INVITE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Recruiter</label>
                <input className="input" list="recruiters" maxLength={60} value={form.recruiter} onChange={(e) => setForm({ ...form, recruiter: e.target.value })} />
                <datalist id="recruiters">{recruiters.map((r) => <option key={r} value={r} />)}</datalist>
              </div>
              <div>
                <label className="label">Assign to alliance</label>
                <Combobox ariaLabel="Assign to alliance" placeholder="Pick a tag or type one" maxLength={40} value={form.assigned_alliance}
                  onChange={(v) => setForm((f) => ({ ...f, assigned_alliance: v }))} options={allianceOptions} />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="label">Notes / Contact (Discord, timezone)</label>
                <textarea className="input h-[5.5rem]" maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                <button className="btn-blue flex-1 sm:flex-none" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update Prospect' : 'Add Prospect'}</button>
                <button type="button" className="btn-ghost" onClick={closeForm}>Cancel</button>
              </div>
            </form>
          </Modal>
          )}
        </>
      )}

      {/* Manage cycles modal */}
      {showAudit && <AuditLog onClose={() => setShowAudit(false)} notify={notify} />}


      {showCycles && (
        <Modal title="Manage Transfer Cycles" onClose={() => { setShowCycles(false); setShowNewCycle(false); setDateEdit(null); }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-400">{cycles.length} cycle{cycles.length === 1 ? '' : 's'} · the open cycle is highlighted</p>
            <button className={showNewCycle ? 'btn-ghost' : 'btn-blue'} onClick={() => setShowNewCycle((v) => !v)}>
              {showNewCycle ? 'Cancel' : '+ New cycle'}
            </button>
          </div>

          {(showNewCycle || !cycles.length) && (
            <form onSubmit={createCycle} className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-gold-500/30 bg-navy-900/60 p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Cycle name</label>
                <input className="input" autoFocus placeholder="e.g. Transfer Cycle #12" maxLength={80} value={newCycle.name} onChange={(e) => setNewCycle({ ...newCycle, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Start date</label>
                <input type="date" required className="input" value={newCycle.start_date}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => setNewCycle({ ...newCycle, start_date: e.target.value, end_date: newCycle.end_date && newCycle.end_date < e.target.value ? '' : newCycle.end_date })} />
              </div>
              <div>
                <label className="label">End date</label>
                <input type="date" required className="input" value={newCycle.end_date} min={newCycle.start_date}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) => setNewCycle({ ...newCycle, end_date: e.target.value })} />
              </div>
              <button className="btn-blue sm:col-span-2">Create cycle</button>
            </form>
          )}

          {!showNewCycle && [['Active', activeCycles], ['Archived', archivedCycles]].map(([label, list]) => list.length > 0 && (
            <section key={label} className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-400">{label} ({list.length})</h3>
              <div className="space-y-2">{list.map(renderCycle)}</div>
            </section>
          ))}
          {!cycles.length && !showNewCycle && <p className="text-sm text-slate-500">No cycles yet. Create your first one above.</p>}
        </Modal>
      )}

      {toast && (
        <div className={`fixed bottom-4 left-1/2 z-[60] w-[92%] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'err' ? 'border-rose-500 bg-rose-950 text-rose-200' : 'border-emerald-500 bg-emerald-950 text-emerald-200'}`}>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
