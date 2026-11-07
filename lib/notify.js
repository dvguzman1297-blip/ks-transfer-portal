import { escapeDiscord, requestSummary } from './requests.js';

// What gets posted to Discord for a new request. Visitor text is escaped (no fake links, formatting or pings), and the
// link goes last so it is never cut off. <...> stops Discord adding a preview card for a login-only page.
export function discordContent(r, link) {
  const body = escapeDiscord(requestSummary(r)).slice(0, 1700);
  return `**New transfer request**\n${body}\n\n📥 Check incoming transfers here: <${link}>`;
}

// Optional outside notifications. Each is skipped unless its settings exist, and a failure never blocks the request
// itself (the in-app badge and live toast come from the database row).
export async function notifyOutside(r, link, env = process.env, fetchImpl = fetch) {
  const jobs = [];
  if (env.DISCORD_WEBHOOK_URL) {
    jobs.push(fetchImpl(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: discordContent(r, link), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    }));
  }
  const to = (env.NOTIFY_EMAIL_TO || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (env.RESEND_API_KEY && to.length) {
    jobs.push(fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM || 'K1886 Transfer Portal <onboarding@resend.dev>',
        to,
        subject: `New transfer request: ${r.ign}`.replace(/[\r\n]+/g, ' '),
        text: `New transfer request\n${requestSummary(r)}\n\nCheck incoming transfers here: ${link}`,
      }),
      signal: AbortSignal.timeout(5000),
    }));
  }
  await Promise.allSettled(jobs);
}
