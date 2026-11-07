// Player lookup against kingshot.net (shared by the member and the public lookup routes).
// kingshot.net exposes this lookup as a Next.js Server Action, not a JSON API.
// The action ID is baked into their build and changes when they redeploy. When that happens the new id is
// found automatically (see discoverActionId). To pin one by hand, copy the `Next-Action` request header from
// DevTools (Network tab on https://kingshot.net/gift-codes/redeem) into LOOKUP_ACTION_ID; auto-discovery is
// then switched off.
const LOOKUP_URL = process.env.PLAYER_LOOKUP_URL || 'https://kingshot.net/gift-codes/redeem';
const ENV_ACTION_ID = process.env.LOOKUP_ACTION_ID;
// Last known good id. If kingshot.net redeploys and this stops working, it is re-discovered automatically
// (see discoverActionId) and remembered here until the server restarts.
let actionId = ENV_ACTION_ID || '40a5dcfd4f441cc26a4b660237cd6fa6a87bf8e4cc';

// Find the current Server Action id by reading kingshot.net's own page script for `lookupPlayer`.
export async function discoverActionId() {
  const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KSTransferPortal/1.0)' }, cache: 'no-store', signal: AbortSignal.timeout(10000) };
  const html = await (await fetch(LOOKUP_URL, opts)).text();
  const chunk = html.match(/\/_next\/static\/chunks\/app\/[^"']*gift-codes\/redeem\/page-[0-9a-f]+\.js/)?.[0];
  if (!chunk) return null;
  const js = await (await fetch(new URL(chunk, LOOKUP_URL).href, opts)).text();
  return js.match(/createServerReference\)?\("([0-9a-f]{40,})"[^)]*"lookupPlayer"\)/)?.[1] ?? null;
}

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

async function callAction(id, playerId) {
  const res = await fetch(LOOKUP_URL, {
    method: 'POST',
    headers: {
      Accept: 'text/x-component',
      'Content-Type': 'text/plain;charset=UTF-8',
      'Next-Action': id,
      Origin: new URL(LOOKUP_URL).origin,
      Referer: LOOKUP_URL,
      'User-Agent': 'Mozilla/5.0 (compatible; KSTransferPortal/1.0)',
    },
    body: JSON.stringify([playerId]),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  return parseFlight(await res.text());
}

// Returns { ok: true, data } or { ok: false, error, status }
export async function lookupPlayer(playerId) {
  try {
    let result = await callAction(actionId, playerId);
    if (!result && !ENV_ACTION_ID) {
      // unknown action id: kingshot.net was redeployed. Look up the new one and retry once.
      const fresh = await discoverActionId().catch(() => null);
      if (fresh && fresh !== actionId) { actionId = fresh; result = await callAction(actionId, playerId); }
    }
    if (!result) return { ok: false, status: 502, error: 'Lookup service changed (Next-Action ID may be outdated). Update LOOKUP_ACTION_ID.' };
    if (result.status !== 'success' || !result.player) {
      if (result.errorKey === 'PLAYER_NOT_FOUND') return { ok: false, status: 404, error: 'Player not found' };
      return { ok: false, status: 502, error: `Lookup failed${result.errorKey ? `: ${result.errorKey}` : ''}` };
    }

    const p = result.player;
    const a = p.alliance;
    return {
      ok: true,
      data: {
        ign: p.name ?? null,
        kingdom: p.kingdom ?? null,
        power: p.power ?? null,
        alliance: a ? (a.abbr ? `[${a.abbr}] ${a.name}` : a.name) : null,
        truegoldGrade: p.levelLabel ?? null,
      },
    };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, status: timedOut ? 504 : 502, error: timedOut ? 'Lookup timed out' : 'Failed to reach lookup service' };
  }
}

// Best-effort in-memory rate limiter (per server instance)
export function makeLimiter(limit, windowMs = 60000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return recent.length > limit;
  };
}
