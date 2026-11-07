// Security regression tests. These read the project's own source and configuration and fail if a rule is broken,
// so a mistake (a secret in the browser code, an unsafe query, a missing header) is caught by `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
// the files this app ships (new files are picked up even before they are committed)
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}
const source = ['app', 'components', 'lib'].flatMap(walk).filter((f) => /\.(js|mjs)$/.test(f));
const isClient = (f) => /^\s*(['"])use client\1/.test(read(f));
const clientFiles = source.filter(isClient);
const SERVER_ONLY = ['lib/openCycles.js', 'lib/notify.js', 'lib/playerLookup.js', 'lib/http.js'];

describe('secrets stay on the server', () => {
  test('the service-role key is only read in one server-only file', () => {
    const users = source.filter((f) => read(f).includes('SUPABASE_SERVICE_ROLE_KEY'));
    assert.deepEqual(users, ['lib/openCycles.js']);
  });
  test('no browser file reads any environment variable except the two public Supabase ones', () => {
    for (const f of clientFiles) {
      const vars = [...read(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
      for (const v of vars) assert.ok(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NODE_ENV'].includes(v), `${f} reads ${v}`);
    }
  });
  test('no browser file imports a server-only module', () => {
    for (const f of clientFiles) {
      const imports = [...read(f).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) for (const bad of SERVER_ONLY) assert.ok(!imp.endsWith(bad.replace('lib/', '').replace('.js', '')) || !imp.includes('lib'), `${f} imports ${imp}`);
    }
  });
  test('only the two intended variables are exposed to the browser (NEXT_PUBLIC_)', () => {
    const pub = new Set(source.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0])));
    assert.deepEqual([...pub].sort(), ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
    assert.ok(!read('.env.example').match(/^NEXT_PUBLIC_(?!SUPABASE_(URL|ANON_KEY))/m));
  });
  test('.env.local is ignored by git and not tracked', () => {
    assert.match(read('.gitignore'), /^\.env\.\*$/m);
    assert.ok(!tracked.some((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== '.env.example'), 'an env file is tracked');
  });
  test('.env.example holds no real secret values', () => {
    for (const line of read('.env.example').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (/KEY|SECRET|WEBHOOK|TOKEN/.test(k)) assert.ok(v === '' || /^YOUR-/.test(v), `${k} has a value`);
    }
  });
  test('no credentials are committed anywhere', () => {
    const patterns = [
      [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\./, 'JWT'],
      [/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/, 'Discord webhook'],
      [/\bre_[A-Za-z0-9]{20,}\b/, 'Resend key'],
      [/sb_secret_[A-Za-z0-9_-]+/, 'Supabase secret key'],
      [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
      [/\bsk-[A-Za-z0-9]{20,}\b/, 'API key'],
    ];
    for (const f of tracked) {
      if (/package-lock\.json$|\.(png|ico|jpg|webp)$/.test(f) || !fs.existsSync(path.join(root, f))) continue;
      const text = read(f);
      for (const [re, what] of patterns) assert.ok(!re.test(text), `${f} contains a ${what}`);
    }
  });
});

describe('no unsafe code patterns', () => {
  test('no eval, new Function, document.write or innerHTML', () => {
    for (const f of source) {
      const t = read(f);
      assert.ok(!/\beval\s*\(|new Function\s*\(|document\.write\s*\(|\.innerHTML\s*=|\.outerHTML\s*=/.test(t), `${f} uses a dangerous API`);
    }
  });
  test('dangerouslySetInnerHTML is used once, for a fixed string with no interpolation', () => {
    const users = source.filter((f) => read(f).includes('dangerouslySetInnerHTML'));
    assert.deepEqual(users, ['app/layout.js']);
    const t = read('app/layout.js');
    const script = t.match(/const THEME_SCRIPT = `([^`]*)`/)?.[1];
    assert.ok(script && !script.includes('${'), 'THEME_SCRIPT must be a constant');
    assert.ok(t.includes('__html: THEME_SCRIPT'));
  });
  test('database queries are never built from strings', () => {
    for (const f of source) {
      const t = read(f);
      assert.ok(!/\.(or|filter|not|match|textSearch|ilike|like)\(\s*`/.test(t), `${f} builds a filter from a template string`);
      // supabase.from(...) / sb.from(...) / .rpc(...) take a fixed name (Array.from is something else)
      for (const m of t.matchAll(/\b(?:supabase|sb)\.(from|rpc)\(\s*([^'"`)\s][^)]*)\)/g)) assert.fail(`${f}: ${m[1]}() must take a literal name, got ${m[2]}`);
      assert.ok(!/\b(?:supabase|sb)\.(from|rpc)\(\s*`/.test(t), `${f} builds a table or function name from a template`);
    }
  });
  test('raw SQL is never run from application code', () => {
    for (const f of source) assert.ok(!/\bexecute_sql|\.query\(\s*[`'"]\s*(select|insert|update|delete|drop)/i.test(read(f)), f);
  });
  test('links that open a new tab use rel="noopener noreferrer"', () => {
    for (const f of source) for (const m of read(f).matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.ok(/rel="[^"]*noopener[^"]*"/.test(m[0]), `${f}: ${m[0].slice(0, 80)}`);
  });
  test('user-controlled data is never placed in an href or src', () => {
    for (const f of source) {
      for (const m of read(f).matchAll(/\b(href|src)=\{([^}]+)\}/g)) {
        assert.ok(/^(`\/[^`$]*`|['"][^'"]*['"]|`\/\$\{HERO_FILE\}`|link|href)$/.test(m[2].trim()) || /^`\/portal/.test(m[2].trim()) || /^`\/\$\{/.test(m[2].trim()), `${f}: ${m[0]}`);
      }
    }
  });
});

describe('public API routes', () => {
  const routes = source.filter((f) => /^app\/api\/.*\/route\.js$/.test(f));
  test('every route sets force-dynamic and no route exports an unexpected method', () => {
    assert.ok(routes.length >= 4);
    for (const f of routes) {
      const t = read(f);
      assert.ok(/export const dynamic = 'force-dynamic'/.test(t), `${f} must not be cached`);
      for (const m of ['PUT', 'DELETE', 'PATCH']) assert.ok(!new RegExp(`export async function ${m}\\b`).test(t), `${f} exports ${m}`);
    }
  });
  test('public POST routes check the origin, cap the body and rate limit', () => {
    for (const f of ['app/api/public-lookup/route.js', 'app/api/request/route.js']) {
      const t = read(f);
      assert.ok(t.includes('sameOrigin(request)'), `${f} must check the origin`);
      assert.ok(t.includes('readJson(request'), `${f} must cap the body size`);
      assert.ok(t.includes('makeLimiter('), `${f} must rate limit`);
    }
  });
  test('the member lookup requires a signed-in, approved user before doing anything', () => {
    const t = read('app/api/lookup/route.js');
    assert.ok(t.indexOf('Sign in required') < t.indexOf('lookupPlayer('));
    assert.ok(t.indexOf("rpc('is_approved')") < t.indexOf('lookupPlayer('));
  });
  test('public routes never return raw upstream or database error text', () => {
    for (const f of ['app/api/public-lookup/route.js', 'app/api/request/route.js', 'app/api/transfer-windows/route.js']) {
      const t = read(f);
      assert.ok(!/error\.message\s*[,}]|err\.message\s*[,}]|\.stack/.test(t.replace(/console\.error\([^)]*\)/g, '')), `${f} may leak an error message`);
      assert.ok(!/fail\(found\.error|fail\(r\.error/.test(t), `${f} returns an upstream message`);
    }
  });
});

describe('HTTP security headers (production build)', () => {
  let headers; let devHeaders;
  const load = async (env, tag) => {
    const saved = { NODE_ENV: process.env.NODE_ENV, DISABLE_CSP: process.env.DISABLE_CSP };
    process.env.NODE_ENV = env; delete process.env.DISABLE_CSP;
    try { const cfg = (await import(`../next.config.mjs?${tag}`)).default; return await cfg.headers(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
  const flat = (rules, source) => Object.fromEntries(rules.filter((r) => r.source === source).flatMap((r) => r.headers).map((h) => [h.key, h.value]));
  test('loads', async () => { headers = await load('production', 'prod'); devHeaders = await load('development', 'dev'); assert.ok(headers.length); });
  test('every page gets the standard protections', () => {
    const h = flat(headers, '/:path*');
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['X-Frame-Options'], 'DENY');
    assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.match(h['Strict-Transport-Security'], /max-age=\d{7,}/);
    assert.match(h['Referrer-Policy'], /strict-origin/);
    assert.match(h['Permissions-Policy'], /camera=\(\)/);
  });
  test('the content security policy locks down framing, plugins, base URL and form targets', () => {
    const csp = flat(headers, '/:path*')['Content-Security-Policy'];
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", 'upgrade-insecure-requests']) assert.ok(csp.includes(d), d);
    assert.ok(!/script-src[^;]*\*/.test(csp.replace('https://*.supabase.co', '')), 'no wildcard script sources');
    assert.ok(!/(default|script)-src[^;]*http:/.test(csp));
  });
  test('API responses are never cached; build files are cached only in production', () => {
    assert.equal(flat(headers, '/api/:path*')['Cache-Control'], 'no-store');
    assert.match(flat(headers, '/_next/static/:path*')['Cache-Control'], /immutable/);
    assert.equal(flat(devHeaders, '/_next/static/:path*')['Cache-Control'], undefined, 'dev files must not be cached');
  });
  test('the server does not advertise itself', async () => {
    const cfg = (await import('../next.config.mjs?prod')).default;
    assert.equal(cfg.poweredByHeader, false);
  });
});

describe('database scripts', () => {
  const sqlFiles = tracked.filter((f) => f.endsWith('.sql') && !f.startsWith('tests/') && !f.startsWith('seed_'));
  const all = sqlFiles.map((f) => read(f)).join('\n');
  test('every SECURITY DEFINER function pins its search_path', () => {
    for (const f of sqlFiles) {
      for (const m of read(f).matchAll(/create or replace function[\s\S]*?security definer[^\n]*/gi)) {
        assert.match(m[0], /set search_path\s*=/i, `${f}: ${m[0].slice(0, 80)}`);
      }
    }
  });
  test('every table in the kstransfers schema has row level security enabled', () => {
    const tables = new Set([...all.matchAll(/create table (?:if not exists )?kstransfers\.(\w+)/gi)].map((m) => m[1]));
    assert.ok(tables.size >= 5);
    for (const t of tables) assert.match(all, new RegExp(`alter table kstransfers\\.${t} enable row level security`, 'i'), `${t} has no RLS`);
  });
  test('the transfer requests script gives anonymous visitors no access at all', () => {
    const t = read('migration_transfer_requests.sql');
    assert.ok(!/grant[^;]*\bto\b[^;]*\banon\b/i.test(t));
    assert.match(t, /revoke all on kstransfers\.transfer_requests from anon, authenticated/i);
    assert.match(t, /enable row level security/i);
    for (const p of ['requests_select', 'requests_update', 'requests_delete']) assert.match(t, new RegExp(`create policy ${p}[\\s\\S]*?is_approved\\(\\)`, 'i'));
  });
  test('the transfer requests table validates its data in the database too', () => {
    const t = read('migration_transfer_requests.sql');
    for (const rule of ["status in ('new', 'accepted', 'dismissed')", 'transfer_passes between 0 and 99', "player_id ~ '^[0-9]{3,20}$'", 'char_length(message) <= 500', 'where status = \'new\'']) assert.ok(t.includes(rule), rule);
  });
  test('no script grants table access to anon after the hardening step', () => {
    const hardening = read('migration_security_hardening.sql');
    assert.match(hardening, /revoke all on schema kstransfers from anon/i);
    assert.match(hardening, /revoke all on all tables in schema kstransfers from anon/i);
  });
});
