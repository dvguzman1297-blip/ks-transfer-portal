import { createClient } from '@supabase/supabase-js';
import { nextCycleNumber } from './utils.js';

// Server-side client with the service-role key (never sent to the browser).
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { db: { schema: 'kstransfers' }, auth: { persistSession: false } });
}

// Pure: what a visitor may choose from, given every cycle.
//   windows: active cycles that have not ended, soonest first, as [{ id, name }]
//   next:    the "next window" option, { label, afterDate }. afterDate is the start of the latest open cycle,
//            or today when none is open.
export function buildWindowOptions(cycles, today = new Date().toISOString().slice(0, 10)) {
  const open = cycles
    .filter((c) => c.status === 'active' && (!c.end_date || c.end_date >= today))
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  const afterDate = open.length ? open[open.length - 1].start_date : today;
  return {
    windows: open.slice(0, 20).map(({ id, name }) => ({ id, name })),
    next: { label: `Next window (Transfer ${nextCycleNumber(cycles)})`, afterDate },
  };
}

// Loads every cycle and builds the options. Throws on a database error.
export async function windowOptions(sb, today) {
  const { data, error } = await sb.from('cycles').select('id, name, status, start_date, end_date');
  if (error) throw error;
  return buildWindowOptions(data, today);
}
