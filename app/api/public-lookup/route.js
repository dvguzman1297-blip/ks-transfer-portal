import { NextResponse } from 'next/server';
import { lookupPlayer, makeLimiter, publicLookupError } from '../../../lib/playerLookup.js';
import { clientIp, readJson, sameOrigin } from '../../../lib/http.js';
import { idText } from '../../../lib/requests.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No login here, so limit hard per IP (in memory, per server instance)
const rateLimited = makeLimiter(10);

const fail = (error, status) => NextResponse.json({ success: false, error }, { status });

export async function POST(request) {
  if (!sameOrigin(request)) return fail('Forbidden', 403);
  if (rateLimited(clientIp(request))) return fail('Too many lookups, please wait a minute', 429);
  const parsed = await readJson(request, 2000);
  if (!parsed.ok) return fail(parsed.error, parsed.status);
  const playerId = idText(parsed.body?.playerId);
  if (!/^\d{3,20}$/.test(playerId)) return fail('Enter a numeric Player ID', 400);

  const r = await lookupPlayer(playerId);
  if (!r.ok) { const e = publicLookupError(r); return fail(e.error, e.status); }
  // only what the form needs to show back to the player
  const { ign, kingdom, power, alliance, truegoldGrade } = r.data;
  return NextResponse.json({ success: true, data: { ign, kingdom, power, alliance, truegoldGrade } });
}
