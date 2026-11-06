// Pure helper functions used by the dashboard. Kept free of React/Next imports so they can be unit tested.

export const INVITE_TYPES = ['Open', 'Special', 'Ordinary'];
export const STATUSES = ['Not Contacted', 'In Talks', 'Considering', 'Committed', 'Rejected'];
export const CSV_COLS = ['player_id', 'ign', 'kingdom', 'power', 'recruiter', 'status', 'alliance', 'truegold_grade', 'assigned_alliance', 'invite_type', 'notes'];

export const STALE_DAYS = 3;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/* ---------- prospects ---------- */
export const isFollowUp = (p, staleBefore) =>
  ['Not Contacted', 'In Talks', 'Considering'].includes(p.status) && new Date(p.updated_at).getTime() < staleBefore;
export const isUnassigned = (p) => !p.recruiter && !['Committed', 'Rejected'].includes(p.status);

/* ---------- dates ---------- */
export function parseLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// How many invites / slots a kingdom gets per transfer cycle (ordinary kingdom vs leading kingdom)
export const SLOT_PRESETS = {
  ordinary: { label: 'Ordinary kingdom', ordinary_slots: 35, special_slots: 3, open_slots: 20 },
  leading: { label: 'Leading kingdom', ordinary_slots: 20, special_slots: 0, open_slots: 10 },
};
export const SLOT_FIELDS = [
  ['Special', 'special_slots'],
  ['Ordinary', 'ordinary_slots'],
  ['Open', 'open_slots'],
];
// Whole number 0-1000 from whatever was typed (blank or junk becomes 0)
export const slotInt = (v) => Math.min(1000, Math.max(0, parseInt(v, 10) || 0));

export const freshCycle = () => {
  const start = new Date(), end = new Date();
  end.setDate(end.getDate() + 6); // transfer windows run about a week
  const { ordinary_slots, special_slots, open_slots } = SLOT_PRESETS.ordinary;
  return { name: '', start_date: isoDate(start), end_date: isoDate(end), ordinary_slots, special_slots, open_slots };
};

// Invites assigned vs left for one cycle. A prospect uses a slot of its invite type unless it was rejected.
export function inviteUsage(prospects, cycle) {
  const rows = [['Special', 'special_slots'], ['Ordinary', 'ordinary_slots'], ['Open', 'open_slots']].map(([type, field]) => {
    const total = slotInt(cycle?.[field]);
    const used = prospects.filter((p) => p.invite_type === type && p.status !== 'Rejected').length;
    return { type, total, used, left: total - used };
  });
  return {
    rows,
    total: rows.reduce((n, r) => n + r.total, 0),
    used: rows.reduce((n, r) => n + r.used, 0),
    untyped: prospects.filter((p) => !p.invite_type && p.status !== 'Rejected').length,
  };
}
export const fmtDate = (s) => parseLocalDate(s)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) ?? '';
export function rangeLabel(start, end) {
  if (!end) return `Starts ${fmtDate(start)} · no end date`;
  const days = Math.round((parseLocalDate(end) - parseLocalDate(start)) / 86400000) + 1;
  return `${fmtDate(start)} – ${fmtDate(end)} · ${days} day${days === 1 ? '' : 's'}`;
}
// Cycles run on UTC: they start at 00:00 UTC on start_date and end when end_date finishes (00:00 UTC the next day).
const utcMidnight = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const pad2 = (n) => String(n).padStart(2, '0');
export function clockParts(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}
export function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${d ? d + 'd ' : ''}${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}
export function cycleCountdown(c, now = Date.now()) {
  if (!c || !c.start_date) return null;
  const start = utcMidnight(c.start_date);
  if (now < start) return { phase: 'upcoming', label: 'Starts in', big: fmtClock(start - now), sub: `${fmtDate(c.start_date)} · 00:00 UTC`, tone: 'text-sky-300', parts: clockParts(start - now), progress: 0 };
  if (!c.end_date) return { phase: 'ongoing', label: '', big: '—', sub: 'No end date set', tone: 'text-slate-400' };
  const end = utcMidnight(c.end_date) + 86400000;
  const left = end - now;
  if (left <= 0) return { phase: 'ended', label: '', big: 'Ended', sub: `${fmtClock(-left)} ago`, tone: 'text-slate-400' };
  const days = left / 86400000;
  return { phase: 'ongoing', label: 'Ends in', big: fmtClock(left), sub: `${fmtDate(new Date(end).toISOString().slice(0, 10))} · 00:00 UTC`, parts: clockParts(left), progress: Math.min(1, (now - start) / (end - start)), tone: days <= 2 ? 'text-rose-300' : days <= 5 ? 'text-amber-300' : 'text-gold-400' };
}

/* ---------- numbers ---------- */
export const fmt = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
// Accepts "153.8M", "1.2B", "120,500,000" or a plain number; returns an integer.
export const parsePower = (v) => {
  if (typeof v === 'number') return Math.round(v) || 0;
  const m = String(v ?? '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) return Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult) || 0;
};
export const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');
export const fmtShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
};

/* ---------- CSV / import safety ---------- */
// Cells that start with = + - @ can run as formulas when a CSV is opened in Excel/Sheets.
export const csvSafe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
// Strip control characters and cap length before anything is sent to the database.
export const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);

export function toCSV(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(csvSafe(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((c) => esc(r[c])).join(','))].join('\n');
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// Turns rows from an imported CSV/JSON file into clean database rows (or throws a readable error).
export function normalizeImportRows(raw, cycleId) {
  if (!Array.isArray(raw)) throw new Error('Expected a list of prospects');
  if (raw.length > MAX_IMPORT_ROWS) throw new Error(`Too many rows (max ${MAX_IMPORT_ROWS} per import)`);
  const rows = raw
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      cycle_id: cycleId,
      // Do not truncate to 20: an over-long id must be rejected by the regex below, not silently cut into a different valid id.
      player_id: clip(r.player_id ?? r.playerId, 64),
      ign: clip(r.ign, 60),
      kingdom: (() => { const k = parseInt(r.kingdom, 10); return k >= 1 && k <= 99999 ? k : null; })(),
      power: parsePower(r.power),
      recruiter: clip(r.recruiter, 60) || null,
      alliance: clip(r.alliance, 80) || null,
      truegold_grade: clip(r.truegold_grade ?? r.truegoldGrade, 20) || null,
      assigned_alliance: clip(r.assigned_alliance, 40) || null,
      invite_type: INVITE_TYPES.find((t) => t.toLowerCase() === clip(r.invite_type, 20).toLowerCase()) || null,
      status: STATUSES.includes(r.status) ? r.status : STATUSES[0],
      notes: clip(r.notes, 2000) || null,
    }))
    .filter((r) => /^\d{3,20}$/.test(r.player_id) && r.ign);
  if (!rows.length) throw new Error('No valid rows found (player_id and ign are required)');
  return rows;
}
