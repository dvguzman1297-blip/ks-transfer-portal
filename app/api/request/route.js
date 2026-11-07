import { NextResponse } from 'next/server';
import { serviceClient, windowOptions } from '../../../lib/openCycles.js';
import { lookupPlayer, makeLimiter, publicLookupError } from '../../../lib/playerLookup.js';
import { clientIp, readJson, sameOrigin, siteOrigin } from '../../../lib/http.js';
import { notifyOutside } from '../../../lib/notify.js';
import { clean, validateRequest } from '../../../lib/requests.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ipLimited = makeLimiter(5, 10 * 60000); // 5 submissions per 10 minutes per IP
const playerLimited = makeLimiter(3, 24 * 3600000); // and 3 a day for any one Player ID (stops spam in someone else's name)

const fail = (error, status) => NextResponse.json({ success: false, error }, { status });

export async function POST(request) {
  const sb = serviceClient();
  if (!sb) return fail('Transfer requests are not set up yet', 503);

  if (!sameOrigin(request)) return fail('Forbidden', 403);
  if (ipLimited(clientIp(request))) return fail('Too many requests, please try again later', 429);

  const parsed = await readJson(request, 10000);
  if (!parsed.ok) return fail(parsed.error, parsed.status);

  // the chosen window must be one of the cycles that is currently open
  let options;
  try { options = await windowOptions(sb); } catch (err) {
    console.error('could not load open cycles', err?.message || err);
    return fail('Could not save your request. Please try again.', 500);
  }
  const v = validateRequest(parsed.body, options.windows, options.next);
  if (!v.ok) return fail(v.error, 400);
  if (playerLimited(v.value.player_id)) return fail('This Player ID has sent too many requests today.', 429);

  // Player details come from our own lookup, never from the browser
  const found = await lookupPlayer(v.value.player_id);
  if (!found.ok) { const e = publicLookupError(found); return fail(e.error, e.status); }
  const p = found.data;

  const row = {
    ...v.value,
    // the lookup is a third party: treat its text like visitor text
    ign: clean(p.ign, 60) || 'Unknown',
    kingdom: Number.isInteger(Number(p.kingdom)) ? Number(p.kingdom) : null,
    power: Number(String(p.power ?? '0').replace(/\D/g, '')) || 0,
    current_alliance: clean(p.alliance, 80) || null,
    truegold_grade: clean(p.truegoldGrade, 20) || null,
  };

  const { error } = await sb.from('transfer_requests').insert(row);
  if (error) {
    if (error.code === '23505') return fail('A request for this Player ID is already waiting for review.', 409);
    console.error('transfer request insert failed', error.message);
    return fail('Could not save your request. Please try again.', 500);
  }

  await notifyOutside(row, `${siteOrigin(request)}/portal/requests`);
  return NextResponse.json({ success: true });
}
