import { NextResponse } from 'next/server';
import { serviceClient, windowOptions } from '../../../lib/openCycles.js';
import { lookupPlayer, makeLimiter } from '../../../lib/playerLookup.js';
import { clientIp, siteOrigin } from '../../../lib/http.js';
import { requestSummary, validateRequest } from '../../../lib/requests.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rateLimited = makeLimiter(5, 10 * 60000); // 5 submissions per 10 minutes per IP

const fail = (error, status) => NextResponse.json({ success: false, error }, { status });

// Optional outside notifications. Each one is skipped unless its env vars are set, and a failure never
// blocks the request itself (the in-app badge and toast come from the database row).
async function notifyOutside(r, link) {
  const summary = requestSummary(r);
  const jobs = [];
  if (process.env.DISCORD_WEBHOOK_URL) {
    jobs.push(fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // the link goes last and is never cut off; <...> stops Discord adding a preview card for a login-only page
      body: JSON.stringify({ content: `**New transfer request**\n${summary.slice(0, 1700)}\n\n📥 Check incoming transfers here: <${link}>`, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    }));
  }
  const to = (process.env.NOTIFY_EMAIL_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (process.env.RESEND_API_KEY && to.length) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.NOTIFY_EMAIL_FROM || 'K1886 Transfer Portal <onboarding@resend.dev>',
        to,
        subject: `New transfer request: ${r.ign}`,
        text: `New transfer request\n${summary}\n\nCheck incoming transfers here: ${link}`,
      }),
      signal: AbortSignal.timeout(5000),
    }));
  }
  await Promise.allSettled(jobs);
}

export async function POST(request) {
  const sb = serviceClient();
  if (!sb) return fail('Transfer requests are not set up yet', 503);

  if (rateLimited(clientIp(request))) return fail('Too many requests, please try again later', 429);

  let body;
  try { body = await request.json(); } catch { return fail('Invalid JSON body', 400); }

  // the chosen window must be one of the cycles that is currently open
  let options;
  try { options = await windowOptions(sb); } catch (err) {
    console.error('could not load open cycles', err?.message || err);
    return fail('Could not save your request. Please try again.', 500);
  }
  const v = validateRequest(body, options.windows, options.next);
  if (!v.ok) return fail(v.error, 400);

  // Player details come from our own lookup, never from the browser
  const found = await lookupPlayer(v.value.player_id);
  if (!found.ok) return fail(found.status === 404 ? 'Player not found. Check your Player ID.' : found.error, found.status);
  const p = found.data;

  const row = {
    ...v.value,
    ign: String(p.ign ?? '').slice(0, 60) || 'Unknown',
    kingdom: Number.isInteger(Number(p.kingdom)) ? Number(p.kingdom) : null,
    power: Number(String(p.power ?? '0').replace(/\D/g, '')) || 0,
    current_alliance: p.alliance ? String(p.alliance).slice(0, 80) : null,
    truegold_grade: p.truegoldGrade ? String(p.truegoldGrade).slice(0, 20) : null,
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
