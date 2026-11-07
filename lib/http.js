export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

// The public address of this site, for links in notifications. Set SITE_URL (e.g. https://k1886.example.com) to be
// explicit; on Vercel the production domain is used automatically; otherwise it is taken from the request.
export function siteOrigin(request) {
  const configured = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  if (configured) return configured.replace(/\/+$/, '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Reads a JSON request body, refusing anything bigger than maxBytes (default 10 KB). Returns
// { ok: true, body } or { ok: false, status, error }.
export async function readJson(request, maxBytes = 10000) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) return { ok: false, status: 413, error: 'Request too large' };
  let text;
  try { text = await request.text(); } catch { return { ok: false, status: 400, error: 'Invalid JSON body' }; }
  if (text.length > maxBytes) return { ok: false, status: 413, error: 'Request too large' };
  try { return { ok: true, body: JSON.parse(text) }; } catch { return { ok: false, status: 400, error: 'Invalid JSON body' }; }
}

// Browsers always send an Origin header on a cross-site POST. For the public endpoints, refuse one that is not this
// site, so another website cannot make visitors' browsers submit requests for it. Requests with no Origin (curl,
// servers) are not browsers acting for a visitor and pass; they are limited by the rate limiter instead.
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let o;
  try { o = new URL(origin); } catch { return false; }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host && o.host === host) return true;
  try { if (process.env.SITE_URL && new URL(process.env.SITE_URL).host === o.host) return true; } catch { /* bad SITE_URL */ }
  return false;
}
