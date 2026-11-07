import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lookupPlayer, makeLimiter } from '../../../lib/playerLookup.js';
import { readJson } from '../../../lib/http.js';
import { idText } from '../../../lib/requests.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Best-effort rate limit per signed-in user (in memory, per server instance)
const rateLimited = makeLimiter(30);

const fail = (error, status) => NextResponse.json({ success: false, error }, { status });

export async function POST(request) {
  // Only signed-in, approved members may use this proxy
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return fail('Sign in required', 401);
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: 'kstransfers' },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await sb.auth.getUser(token);
  if (authError || !auth?.user) return fail('Session expired, please sign in again', 401);
  const { data: approved } = await sb.rpc('is_approved');
  if (!approved) return fail('Your account is not approved yet', 403);
  if (rateLimited(auth.user.id)) return fail('Too many lookups, please wait a minute', 429);

  const parsed = await readJson(request, 2000);
  if (!parsed.ok) return fail(parsed.error, parsed.status);

  const playerId = idText(parsed.body?.playerId);
  if (!/^\d{3,20}$/.test(playerId)) return fail('playerId must be a numeric Player ID', 400);

  const r = await lookupPlayer(playerId);
  if (!r.ok) return fail(r.error, r.status);
  return NextResponse.json({ success: true, data: r.data });
}
