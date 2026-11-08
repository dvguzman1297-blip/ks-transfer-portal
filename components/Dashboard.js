'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import HeaderMenu from './HeaderMenu';
import { ALLIANCES } from '@/lib/alliances';
import { Combobox, DashboardSkeleton, Modal, useConfirm } from './ui';

// Only admins open this, so keep it out of the main bundle
const AuditLog = dynamic(() => import('./AuditLog'), { ssr: false });
import {
  INVITE_TYPES, STATUSES, STALE_DAYS, MAX_IMPORT_BYTES, CSV_COLS,
  isFollowUp, isUnassigned, freshCycle, rangeLabel, cycleCountdown, SLOT_PRESETS, SLOT_FIELDS, slotInt, inviteUsage,
  fmt, parsePower, digits, fmtShort, toCSV, parseCSV, normalizeImportRows, templateCSV, suggestNextCycle, nextCycleNudge,
} from '@/lib/utils';

// Number inputs for a cycle's invite totals, plus one-click presets for the two kingdom types
function SlotFields({ value, onChange }) {
  const total = SLOT_FIELDS.reduce((n, [, f]) => n + slotInt(value[f]), 0);
  return (
    <div className="rounded-lg border border-navy-600 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label !mb-0">Invites this cycle</span>
        <div className="flex gap-1.5">
          {Object.values(SLOT_PRESETS).map((p) => (
            <button type="button" key={p.label} className="btn-ghost px-2 py-1 text-xs"
              onClick={() => onChange({ ...value, ordinary_slots: p.ordinary_slots, special_slots: p.special_slots, open_slots: p.open_slots })}>
              {p.label} ({p.special_slots}/{p.ordinary_slots}/{p.open_slots})
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SLOT_FIELDS.map(([label, f]) => (
          <div key={f}>
            <label className="mb-1 block text-xs text-slate-400" htmlFor={`slots-${f}`}>{label}</label>
            <input id={`slots-${f}`} type="number" inputMode="numeric" min="0" max="1000" className="input"
              value={value[f] ?? ''} onChange={(e) => onChange({ ...value, [f]: e.target.value })} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Total transfer cap: <b className="text-slate-300">{total}</b> governors</p>
    </div>
  );
}

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
const PHASE_LABEL = { upcoming: 'Starts in', ongoing: 'Ongoing · ends in', ended: 'Ended' };
const PHASE_STYLE = {
  upcoming: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  ongoing: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  ended: 'border-slate-500/50 bg-slate-500/10 text-slate-400',
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
export default function Dashboard({ menuItems = [], isAdmin = false, userName = '', reloadKey = 0, requests = null, nextCycleSignal = 0 }) {
  const [cycles, setCycles] = useState([]);
  const [cycleId, setCycleId] = useState('');
  const [prospects, setProspects] = useState([]);
  const [cycleStats, setCycleStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [ask, confirmDialog] = useConfirm();

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);

  const [showCycles, setShowCycles] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [newCycle, setNewCycle] = useState(freshCycle);
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [suggestWeeks, setSuggestWeeks] = useState(null); // 8 | 6 while the new-cycle form holds a suggestion
  const [nudgeHidden, setNudgeHidden] = useState(false);

  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState(''); // '' | 'followup' | 'unassigned'
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterBox = useRef(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e) => { if (!filterBox.current?.contains(e.target)) setFiltersOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [filtersOpen]);
  const [dateEdit, setDateEdit] = useState(null); // { id, name, start, end }
  const [fStatus, setFStatus] = useState('');
  const [fAssigned, setFAssigned] = useState('');
  const [fRecruiter, setFRecruiter] = useState('');
  const [fInvite, setFInvite] = useState(''); // '' | 'Special' | 'Ordinary' | 'Open' | '__none'
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

  useEffect(() => { loadProspects(cycleId); }, [cycleId, loadProspects, reloadKey]);
  useEffect(() => { if (showCycles) loadStats(); }, [showCycles, loadStats]);

  /* ----- cycles ----- */
  // Open the new-cycle form pre-filled from the latest cycle (windows are usually 8 weeks apart, sometimes 6)
  function openNextCycle(weeks = 8) {
    const s = suggestNextCycle(cycles, weeks);
    setNewCycle(s || freshCycle());
    setSuggestWeeks(s ? weeks : null);
    setShowNewCycle(true);
    setShowCycles(true);
  }
  // the requests inbox asks for the next cycle to be created
  const handledSignal = useRef(0);
  useEffect(() => {
    if (nextCycleSignal > handledSignal.current && !loading) { handledSignal.current = nextCycleSignal; openNextCycle(8); }
  }, [nextCycleSignal, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createCycle(e) {
    e.preventDefault();
    if (!newCycle.name.trim()) return;
    const { data, error } = await supabase.from('cycles').insert({
      name: newCycle.name.trim(),
      start_date: newCycle.start_date,
      end_date: newCycle.end_date || null,
      ordinary_slots: slotInt(newCycle.ordinary_slots),
      special_slots: slotInt(newCycle.special_slots),
      open_slots: slotInt(newCycle.open_slots),
      status: 'active',
    }).select().single();
    if (error) return notify(error.message, 'err');
    setNewCycle(freshCycle());
    setSuggestWeeks(null);
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
      ordinary_slots: slotInt(dateEdit.ordinary_slots),
      special_slots: slotInt(dateEdit.special_slots),
      open_slots: slotInt(dateEdit.open_slots),
    }).eq('id', dateEdit.id);
    if (error) return notify(error.message, 'err');
    setDateEdit(null);
    await loadCycles();
    notify('Cycle updated');
  }

  async function deleteCycle(c) {
    const n = cycleStats[c.id]?.total ?? 0;
    if (!(await ask({
      title: `Delete "${c.name}"?`,
      message: n ? `This also deletes its ${n} prospect${n === 1 ? '' : 's'}. This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Delete cycle',
    }))) return;
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
    if (!(await ask({ title: `Delete ${p.ign}?`, message: 'This removes the prospect from this cycle. This cannot be undone.', confirmLabel: 'Delete prospect' }))) return false;
    const { error } = await supabase.from('prospects').delete().eq('id', p.id);
    if (error) { notify(error.message, 'err'); return false; }
    setProspects((list) => list.filter((x) => x.id !== p.id));
    return true;
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
      if (!(await ask({ title: `Import ${rows.length} prospects?`, message: `They will be added to "${currentCycle?.name}".`, confirmLabel: 'Import', danger: false }))) return;
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

  // Who is heading where: every prospect except the rejected ones, grouped by assigned alliance
  const byAlliance = useMemo(() => {
    const map = new Map();
    const none = { total: 0, committed: 0, power: 0, committedPower: 0 };
    let power = 0, committedPower = 0;
    for (const p of prospects) {
      if (p.status === 'Rejected') continue;
      const tag = (p.assigned_alliance || '').trim();
      const slot = tag ? (map.get(tag) || map.set(tag, { tag, total: 0, committed: 0, power: 0, committedPower: 0 }).get(tag)) : none;
      const pw = Number(p.power) || 0;
      slot.total++; slot.power += pw; power += pw;
      if (p.status === 'Committed') { slot.committed++; slot.committedPower += pw; committedPower += pw; }
    }
    return { rows: [...map.values()].sort((a, b) => b.power - a.power || a.tag.localeCompare(b.tag)), none, power, committedPower };
  }, [prospects]);

  const invites = useMemo(() => inviteUsage(prospects, currentCycle), [prospects, currentCycle]);

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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const countdown = cycleCountdown(currentCycle, now);
  const nudge = useMemo(() => nextCycleNudge(cycles), [cycles]);
  // players who asked for the "next window" and no cycle starting after their date exists yet
  const waitingForNext = (requests?.nextWaiting || []).filter((d) => !cycles.some((c) => c.start_date > d)).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const staleBefore = Date.now() - STALE_DAYS * 86400000;
    const list = prospects.filter((p) => {
      if (quick === 'followup' && !isFollowUp(p, staleBefore)) return false;
      if (quick === 'unassigned' && !isUnassigned(p)) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fAssigned && (fAssigned === '__none' ? p.assigned_alliance : p.assigned_alliance !== fAssigned)) return false;
      if (fRecruiter && p.recruiter !== fRecruiter) return false;
      if (fInvite && (fInvite === '__none' ? p.invite_type : p.invite_type !== fInvite)) return false;
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
  }, [prospects, search, fStatus, fAssigned, fRecruiter, fInvite, quick, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'power' ? 'desc' : 'asc' }));

  const Th = ({ k, children, className = '' }) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`whitespace-nowrap text-left text-xs font-semibold uppercase tracking-wide text-gold-400 ${className}`}>
      <button type="button" className="w-full px-3 py-2 text-left uppercase tracking-wide hover:text-gold-300" onClick={() => toggleSort(k)}>
        {children} {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  const clearFilters = () => { setSearch(''); setFStatus(''); setFAssigned(''); setFRecruiter(''); setFInvite(''); setQuick(''); };
  const activeFilterCount = [fStatus, fAssigned, fInvite, fRecruiter, quick].filter(Boolean).length;
  const filtersActive = search || fStatus || fAssigned || fRecruiter || fInvite || quick;

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
          <button className="btn-ghost px-3 py-1.5" onClick={() => setDateEdit(dateEdit?.id === c.id ? null : { id: c.id, name: c.name, start: c.start_date, end: c.end_date ?? '', ordinary_slots: c.ordinary_slots ?? 0, special_slots: c.special_slots ?? 0, open_slots: c.open_slots ?? 0 })}>✎ Edit</button>
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
            <div className="sm:col-span-3">
              <SlotFields value={dateEdit} onChange={setDateEdit} />
            </div>
            <div className="flex items-end gap-2 sm:col-span-3">
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
      <header className="relative mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 pr-14 sm:pr-0">
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
          <button className="btn-gold shrink-0" onClick={() => setShowCycles(true)}>Manage Cycles</button>
          {requests && (
            <Link href="/portal/requests" className="btn-ghost relative shrink-0"
              aria-label={`Transfer requests${requests.count ? `, ${requests.count} new` : ''}`}>
              <span aria-hidden="true">📥</span> Requests
              {requests.count > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950">{requests.count}</span>}
            </Link>
          )}
          {/* pinned to the top-right corner on phones, inline on larger screens */}
          <div className="absolute right-0 top-0 sm:static">
            <HeaderMenu items={[
              ...menuItems,
              ...(isAdmin ? [{ label: 'Audit Log', icon: '📜', onClick: () => setShowAudit(true) }] : []),
            ]} />
          </div>
        </div>
      </header>

      {!loading && (nudge || waitingForNext > 0) && !nudgeHidden && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span>
            {nudge && (nudge.ended
              ? <><b>{nudge.cycle.name}</b> has ended and there is no later cycle yet.</>
              : <><b>{nudge.cycle.name}</b> ends {nudge.daysLeft === 0 ? 'today' : `in ${nudge.daysLeft} day${nudge.daysLeft === 1 ? '' : 's'}`} and the next cycle is not created yet.</>)}
            {waitingForNext > 0 && <>{nudge ? ' ' : ''}<b>{waitingForNext} player{waitingForNext === 1 ? ' is' : 's are'}</b> waiting for the next cycle.</>}
          </span>
          <span className="flex gap-2">
            <button className="btn-gold px-3 py-1" onClick={() => openNextCycle(8)}>Create next cycle</button>
            <button className="btn-ghost px-3 py-1" onClick={() => setNudgeHidden(true)} aria-label="Dismiss reminder">Later</button>
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-bold text-slate-100 sm:text-xl">
          {userName && <>Welcome, <span className="text-gold-400">{userName}</span></>}
        </p>
        {countdown && (
          <div className="card relative flex flex-wrap items-center gap-x-3 gap-y-0.5 overflow-hidden px-3 py-2 !shadow-none">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PHASE_STYLE[countdown.phase]}`}>
              {countdown.phase === 'ongoing' && <span aria-hidden="true" className="mr-1">●</span>}{countdown.phase === 'ongoing' && !countdown.parts ? 'Ongoing' : PHASE_LABEL[countdown.phase]}
            </span>
            {countdown.parts ? (
              <div className={`flex items-baseline gap-2 font-extrabold tabular-nums ${countdown.tone}`} role="timer" aria-label={countdown.big}>
                {[['d', 'd'], ['h', 'h'], ['m', 'm'], ['s', 's']].map(([k, u]) => (
                  <span key={k} className="text-xl leading-none">
                    {String(countdown.parts[k]).padStart(2, '0')}<span className="ml-0.5 text-xs font-semibold opacity-60">{u}</span>
                  </span>
                ))}
              </div>
            ) : countdown.phase === 'ended' ? null : (
              <span className={`text-xl font-extrabold ${countdown.tone}`}>{countdown.big}</span>
            )}
            <span className="text-[11px] text-slate-400">{countdown.sub}</span>
            {countdown.parts && countdown.progress > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-navy-700" title={`${Math.round(countdown.progress * 100)}% of the cycle has passed`}>
                <div className="h-full bg-gold-400/80" style={{ width: `${Math.round(countdown.progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : !cycles.length ? (
        <div className="card mx-auto max-w-md p-6 text-center">
          <p className="mb-4 text-slate-300">No transfer cycles yet. Create your first one to start tracking prospects.</p>
          <button className="btn-blue" onClick={() => setShowCycles(true)}>Create Transfer Cycle</button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <section className="card mb-5 flex flex-col gap-4 p-4">
            {/* Title + the committed-power headline */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="text-sm font-bold uppercase tracking-wide text-gold-400">
                Pipeline <span className="font-semibold normal-case tracking-normal text-slate-400">· {prospects.length} prospect{prospects.length === 1 ? '' : 's'}</span>
                {currentCycle?.status === 'archived' && <span className="ml-2 text-xs font-normal normal-case tracking-normal text-slate-500">Archived cycle</span>}
                {fStatus && <button className="ml-3 text-xs font-normal normal-case tracking-normal text-gold-400 underline" onClick={() => setFStatus('')}>Show all</button>}
              </h2>
              <div className="flex items-baseline gap-5 text-xs uppercase tracking-wide text-slate-400">
                <span title={fmt(summary.power)}>Committed power <b className="ml-1 text-xl font-extrabold normal-case tracking-normal text-gold-400">{fmtShort(summary.power)}</b></span>
                <span>Avg / player <b className="ml-1 text-xl font-extrabold normal-case tracking-normal text-slate-200">{summary.avg ? fmtShort(summary.avg) : '—'}</b></span>
              </div>
            </div>

            {/* Status filters */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setFStatus(fStatus === s ? '' : s)}
                  title={`${prospects.length ? Math.round((summary.byStatus[s] / prospects.length) * 100) : 0}% of the cycle`}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left ${STATUS_STYLE[s]} ${fStatus === s ? 'ring-2 ring-gold-400' : ''}`}>
                  <span className="text-xs">{STATUS_ICON[s]} {s}</span>
                  <span className="text-2xl font-extrabold leading-none">{summary.byStatus[s]}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-x-10 gap-y-5 border-t border-navy-700 pt-4 lg:grid-cols-2">
              {/* Left: invites, then what needs attention */}
              <div className="flex flex-col gap-5">
                <div>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-gold-400">
                      Invites
                      {fInvite && <button className="ml-3 font-normal normal-case tracking-normal text-gold-400 underline" onClick={() => setFInvite('')}>Show all</button>}
                    </h3>
                    {invites.total > 0 && (
                      <span className="text-xs text-slate-400" title="Rejected prospects do not use a slot">
                        <b className="text-sm text-slate-100">{invites.used}</b> of {invites.total} assigned · <b className="text-sm text-emerald-400">{Math.max(0, invites.total - invites.used)}</b> left
                      </span>
                    )}
                  </div>
                  {invites.total > 0 ? (
                    <div className="space-y-2">
                      {invites.rows.map((r) => {
                        const over = r.left < 0;
                        const pct = r.total ? Math.min(100, Math.round((r.used / r.total) * 100)) : (r.used ? 100 : 0);
                        return (
                          <button key={r.type} onClick={() => setFInvite(fInvite === r.type ? '' : r.type)}
                            title={`${r.used} ${r.type} invites assigned of ${r.total}. Click to filter the roster.`}
                            className={`flex w-full items-center gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-navy-700/50 ${fInvite === r.type ? 'bg-gold-500/10' : ''}`}>
                            <span className="w-16 shrink-0 font-semibold text-slate-100">{r.type}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-navy-700">
                              <div className={`h-full rounded-full ${over ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-12 shrink-0 text-right text-xs text-slate-400"><b className="text-sm text-slate-100">{r.used}</b>/{r.total}</span>
                            <span className={`w-20 shrink-0 text-right text-xs ${over ? 'font-semibold text-rose-300' : 'text-slate-400'}`}>{over ? `over by ${-r.left}` : `${r.left} left`}</span>
                          </button>
                        );
                      })}
                      {invites.untyped > 0 && (
                        <button onClick={() => setFInvite(fInvite === '__none' ? '' : '__none')}
                          className={`rounded-md px-2 py-0.5 text-left text-[11px] text-amber-300 underline-offset-2 hover:underline ${fInvite === '__none' ? 'bg-gold-500/10' : ''}`}>
                          {invites.untyped} prospect{invites.untyped === 1 ? ' has' : 's have'} no invite type yet and are not counted · show
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No invite totals set for this cycle. Add them under Manage Cycles → Edit.</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gold-400">Needs attention</h3>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button onClick={() => setQuick(quick === 'followup' ? '' : 'followup')}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 ${quick === 'followup' ? 'border-gold-400 bg-gold-500/10' : 'border-navy-600'}`}>
                      Follow up <span className="text-xs text-slate-500">({STALE_DAYS}d+ idle)</span>
                      <b className={summary.followUp ? 'text-amber-300' : 'text-slate-500'}>{summary.followUp}</b>
                    </button>
                    <button onClick={() => setQuick(quick === 'unassigned' ? '' : 'unassigned')}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 ${quick === 'unassigned' ? 'border-gold-400 bg-gold-500/10' : 'border-navy-600'}`}>
                      No recruiter
                      <b className={summary.unassigned ? 'text-amber-300' : 'text-slate-500'}>{summary.unassigned}</b>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: where everyone is going */}
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-gold-400">
                    Alliance assignments
                    {fAssigned && <button className="ml-3 font-normal normal-case tracking-normal text-gold-400 underline" onClick={() => setFAssigned('')}>Show all</button>}
                  </h3>
                  <span className="text-xs text-slate-400" title="Combined power of everyone assigned who has not been rejected">Incoming <b className="ml-1 text-sm text-gold-300">+{fmtShort(byAlliance.power)}</b></span>
                </div>
                <div className="divide-y divide-navy-700/60">
                  {[...byAlliance.rows, ...(byAlliance.none.total ? [{ tag: 'Unassigned', key: '__none', ...byAlliance.none }] : [])].map((r) => {
                    const key = r.key || r.tag;
                    return (
                      <button key={key} onClick={() => setFAssigned(fAssigned === key ? '' : key)}
                        title={`${r.total} going to ${r.tag}: +${fmt(r.power)} power. ${r.committed} committed (+${fmt(r.committedPower)}). Click to filter the roster.`}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-navy-700/50 ${fAssigned === key ? 'bg-gold-500/10' : ''}`}>
                        <span className={`w-24 shrink-0 truncate font-semibold ${r.key ? 'text-slate-400' : 'text-slate-100'}`}>{r.tag}</span>
                        <span className="flex-1 text-xs text-slate-400">
                          {r.total} player{r.total === 1 ? '' : 's'}
                          {r.committed > 0 && <span className="ml-2 text-emerald-400">✓ {r.committed} committed</span>}
                        </span>
                        <b className="shrink-0 text-gold-300">+{fmtShort(r.power)}</b>
                      </button>
                    );
                  })}
                  {!byAlliance.rows.length && !byAlliance.none.total && <p className="py-1 text-xs text-slate-500">No prospects yet.</p>}
                </div>
              </div>
            </div>
          </section>

          {/* Roster */}
          <section className="card p-3 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-lg font-bold text-gold-400">Prospect Roster <span className="text-sm font-normal text-slate-400">({visible.length}/{prospects.length})</span>
                {filtersActive && <button className="ml-3 text-xs font-normal text-gold-400 underline" onClick={clearFilters}>Clear filters</button>}
              </h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn-blue" onClick={openAdd}>+ Add Prospect</button>
                <button className="btn-ghost" onClick={exportCSV}>⬇ Export Cycle to CSV</button>
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>⬆ Import JSON/CSV</button>
                <button className="btn-ghost" title="A blank CSV with the right columns and two example rows to fill in, then import"
                  onClick={() => download('prospects_template.csv', '﻿' + templateCSV(), 'text/csv;charset=utf-8')}>📄 Template</button>
                <input ref={fileRef} type="file" accept=".json,.csv,text/csv,application/json" className="hidden" onChange={importFile} />
              </div>
            </div>

            <div className="mb-3 flex gap-2">
              <input className="input min-w-0 flex-1" type="search" aria-label="Search prospects" placeholder="🔎 Search name, ID, kingdom, alliance, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="relative shrink-0" ref={filterBox}>
                <button type="button" className={`btn-ghost h-full ${activeFilterCount ? 'border-gold-500/60' : ''}`} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
                  Filters
                  {activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-gold-500 px-1.5 text-[10px] font-bold text-slate-950">{activeFilterCount}</span>}
                </button>
                {filtersOpen && (
                  <div role="dialog" aria-label="Filters" className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-gold-500/30 bg-navy-800 p-3 shadow-xl shadow-black/30">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gold-400">Status</span>
                    <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                      <option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gold-400">Assigned alliance</span>
                    <select className="input" value={fAssigned} onChange={(e) => setFAssigned(e.target.value)}>
                      <option value="">All assignments</option>
                      <option value="__none">Unassigned</option>
                      {assignedAlliances.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gold-400">Invite type</span>
                    <select className="input" value={fInvite} onChange={(e) => setFInvite(e.target.value)}>
                      <option value="">All invites</option>
                      {['Special', 'Ordinary', 'Open'].map((t) => <option key={t}>{t}</option>)}
                      <option value="__none">No invite type</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gold-400">Recruiter</span>
                    <select className="input" value={fRecruiter} onChange={(e) => setFRecruiter(e.target.value)}>
                      <option value="">All recruiters</option>{recruiters.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gold-400">Needs attention</span>
                    <select className="input" value={quick} onChange={(e) => setQuick(e.target.value)}>
                      <option value="">Everyone</option>
                      <option value="followup">Follow up ({STALE_DAYS}d+ idle)</option>
                      <option value="unassigned">No recruiter</option>
                    </select>
                  </label>
                    <div className="flex items-center justify-between pt-1">
                      <button type="button" className="text-xs text-gold-400 underline disabled:opacity-40 disabled:no-underline" disabled={!activeFilterCount}
                        onClick={() => { setFStatus(''); setFAssigned(''); setFInvite(''); setFRecruiter(''); setQuick(''); }}>Reset filters</button>
                      <button type="button" className="btn-gold px-4 py-1.5" onClick={() => setFiltersOpen(false)}>Done</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="max-h-[75vh] overflow-auto rounded-lg border border-navy-600">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-navy-900 shadow-[0_1px_0_rgb(var(--navy-600))]">
                  <tr>
                    <Th k="ign" className="sticky left-0 z-20 bg-navy-900">IGN</Th><Th k="player_id">ID</Th><Th k="kingdom">KINGDOM</Th>
                    <Th k="power">Power</Th><Th k="alliance">Alliance</Th><Th k="truegold_grade">TC</Th><Th k="recruiter">Recruiter</Th><Th k="assigned_alliance">Assigned To</Th><Th k="invite_type">Invite</Th>
                    <Th k="status">Status</Th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gold-400">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-700">
                  {visible.map((p) => (
                    <tr key={p.id} tabIndex={0} role="button" aria-label={`View details for ${p.ign}`}
                      className="cursor-pointer hover:bg-navy-700/40 focus:bg-navy-700/40 focus:outline-none"
                      onClick={() => editProspect(p)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editProspect(p); } }}>
                      <td className="sticky left-0 z-[1] whitespace-nowrap bg-navy-800 px-3 py-2 font-semibold text-slate-100">
                        <div className="flex items-center gap-2">
                          <button className="rounded px-1 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300" onClick={(e) => { e.stopPropagation(); deleteProspect(p); }} aria-label={`Delete ${p.ign}`} title="Delete">🗑</button>
                          <span>{p.ign}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{p.player_id}</td>
                      <td className="px-3 py-2">{p.kingdom ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gold-300">{fmt(p.power)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{p.alliance || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gold-300">{p.truegold_grade || '—'}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select value={p.recruiter || ''} onChange={(e) => updateField(p, 'recruiter', e.target.value)}
                          aria-label={`Recruiter for ${p.ign}`}
                          className={`rounded-full border border-navy-600 bg-navy-900 px-2 py-1 text-xs outline-none ${p.recruiter ? 'text-slate-100' : 'text-slate-500'}`}>
                          <option value="" className="bg-navy-900 text-slate-400">—</option>
                          {recruiters.map((r) => <option key={r} value={r} className="bg-navy-900 text-slate-100">{r}</option>)}
                        </select>
                      </td>
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
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-500">
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
                {editingId && (
                  <button type="button" className="btn-ghost ml-auto text-rose-300 hover:border-rose-500/60" disabled={saving}
                    onClick={async () => {
                      const p = prospects.find((x) => x.id === editingId);
                      if (p && await deleteProspect(p)) closeForm();
                    }}>
                    🗑 Delete
                  </button>
                )}
              </div>
            </form>
          </Modal>
          )}
        </>
      )}

      {/* Manage cycles modal */}
      {isAdmin && showAudit && <AuditLog cycles={cycles} currentCycleId={cycleId} onClose={() => setShowAudit(false)} notify={notify} />}


      {showCycles && (
        <Modal title="Manage Transfer Cycles" onClose={() => { setShowCycles(false); setShowNewCycle(false); setSuggestWeeks(null); setDateEdit(null); }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-400">{cycles.length} cycle{cycles.length === 1 ? '' : 's'} · the open cycle is highlighted</p>
            <div className="flex gap-2">
              {!showNewCycle && cycles.length > 0 && (
                <button className="btn-gold" onClick={() => openNextCycle(8)} title="Pre-filled from the latest cycle">Next cycle ›</button>
              )}
              <button className={showNewCycle ? 'btn-ghost' : 'btn-blue'}
                onClick={() => { if (showNewCycle) { setShowNewCycle(false); setSuggestWeeks(null); } else { setNewCycle(freshCycle()); setSuggestWeeks(null); setShowNewCycle(true); } }}>
                {showNewCycle ? 'Cancel' : '+ New cycle'}
              </button>
            </div>
          </div>

          {(showNewCycle || !cycles.length) && (
            <form onSubmit={createCycle} className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-gold-500/30 bg-navy-900/60 p-3 sm:grid-cols-2">
              {suggestWeeks && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                  <span>Suggested from the latest cycle. Check the dates against the announcement.</span>
                  {[8, 6].map((w) => (
                    <button type="button" key={w} aria-pressed={suggestWeeks === w} onClick={() => openNextCycle(w)}
                      className={`btn-ghost px-2 py-1 text-xs ${suggestWeeks === w ? '!border-gold-400 !bg-gold-500/10' : ''}`}>{w} weeks later</button>
                  ))}
                </div>
              )}
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
              <div className="sm:col-span-2">
                <SlotFields value={newCycle} onChange={setNewCycle} />
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

      {confirmDialog}

      {toast && (
        <div role={toast.type === 'err' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-4 left-1/2 z-[60] w-[92%] max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-xl ${toast.type === 'err' ? 'border-rose-500 bg-rose-950 text-rose-200' : 'border-emerald-500 bg-emerald-950 text-emerald-200'}`}>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
