import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// kingshot.net exposes this lookup as a Next.js Server Action, not a JSON API.
// The action ID is baked into their build and changes when they redeploy; if lookups start
// failing with "action not found", copy the new `Next-Action` request header value from
// DevTools (Network tab on https://kingshot.net/gift-codes/redeem) into LOOKUP_ACTION_ID.
const LOOKUP_URL = process.env.PLAYER_LOOKUP_URL || 'https://kingshot.net/gift-codes/redeem';
const ACTION_ID = process.env.LOOKUP_ACTION_ID || '40a0e42e8e4e33730f0902091d58e4d46152e99760';

// Best-effort rate limit per signed-in user (in memory, per server instance)
const hits = new Map();
function rateLimited(key, limit = 30, windowMs = 60000) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return recent.length > limit;
}

const fail = (error, status) => NextResponse.json({ success: false, error }, { status });

// The response is an RSC stream: lines like `1:{...json...}`. Find the line carrying `status`.
function parseFlight(text) {
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+:(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === 'object' && 'status' in obj) return obj;
    } catch {}
  }
  return null;
}

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

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON body', 400);
  }

  const playerId = String(body?.playerId ?? '').trim();
  if (!/^\d{3,20}$/.test(playerId)) return fail('playerId must be a numeric Player ID', 400);

  try {
    const res = await fetch(LOOKUP_URL, {
      method: 'POST',
      headers: {
        Accept: 'text/x-component',
        'Content-Type': 'text/plain;charset=UTF-8',
        'Next-Action': ACTION_ID,
        Origin: new URL(LOOKUP_URL).origin,
        Referer: LOOKUP_URL,
        'User-Agent': 'Mozilla/5.0 (compatible; KSTransferPortal/1.0)',
      },
      body: JSON.stringify([playerId]),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    const result = parseFlight(text);

    if (!result) {
      return fail('Lookup service changed (Next-Action ID may be outdated). Update LOOKUP_ACTION_ID.', 502);
    }
    if (result.status !== 'success' || !result.player) {
      if (result.errorKey === 'PLAYER_NOT_FOUND') return fail('Player not found', 404);
      return fail(`Lookup failed${result.errorKey ? `: ${result.errorKey}` : ''}`, 502);
    }

    const p = result.player;
    const a = p.alliance;
    const alliance = a ? (a.abbr ? `[${a.abbr}] ${a.name}` : a.name) : null;

    return NextResponse.json({
      success: true,
      data: {
        ign: p.name ?? null,
        kingdom: p.kingdom ?? null,
        power: p.power ?? null,
        alliance,
        truegoldGrade: p.levelLabel ?? null,
      },
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fail(timedOut ? 'Lookup timed out' : 'Failed to reach lookup service', timedOut ? 504 : 502);
  }
}
