const isProd = process.env.NODE_ENV === 'production';

// Allow the browser to talk to this app's own origin and the Supabase project only.
let supabaseOrigin = 'https://*.supabase.co';
let supabaseWs = 'wss://*.supabase.co';
try {
  const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  supabaseOrigin = u.origin;
  supabaseWs = `wss://${u.host}`;
} catch {
  // fall back to the wildcard above
}

// Content-Security-Policy. Next.js needs inline scripts/styles, so 'unsafe-inline' is allowed;
// everything else (other origins, plugins, framing, form posts elsewhere) is blocked.
// Set DISABLE_CSP=1 to turn it off if it ever blocks something legitimate.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  ...(isProd && !process.env.DISABLE_CSP ? [{ key: 'Content-Security-Policy', value: csp }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // fingerprinted build files never change: cache for a year
      { source: '/_next/static/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // un-fingerprinted images: cache a day, serve stale while refreshing so updates still arrive
      { source: '/:file(logo.png|icon.png|apple-icon.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
      // the lookup proxy returns per-user data: never cache
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
