// End-to-end tests of the public API routes with every network call mocked
// (Supabase REST, kingshot.net, Discord). Covers input handling, injection payloads, abuse limits and error hygiene.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/hook';
process.env.SITE_URL = 'https://k1886.example.com';
delete process.env.LOOKUP_ACTION_ID;
delete process.env.RESEND_API_KEY;

// ---------- the pretend outside world ----------
const world = {};
const seen = {};
function reset() {
  world.cycles = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Transfer 9 - Nov. 8-14, 2026', status: 'active', start_date: '2026-11-08', end_date: '2099-11-14' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Transfer 8 - Sep. 13-19, 2026', status: 'archived', start_date: '2026-09-13', end_date: '2026-09-19' },
  ];
  world.player = { playerId: '290313686', name: 'j3ttybear', kingdom: 1886, level: 45, levelLabel: 'TG3', power: '153789982', alliance: { id: 'x', name: 'GemstoneTavern', abbr: 'T86' } };
  world.kingshot = 'success'; // success | notfound | html | invalid | throw | slow
  world.dbInsert = 'ok'; // ok | duplicate | error
  world.dbRead = 'ok'; // ok | error
  world.discord = 'ok'; // ok | throw
  seen.inserts = []; seen.discord = []; seen.kingshot = 0; seen.dbHeaders = [];
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const RSC = (player) => `0:{"a":"$@1"}\n1:${JSON.stringify({ status: 'success', player })}\n`;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://test-project.supabase.co/rest/v1/cycles')) {
    seen.dbHeaders.push(init.headers);
    if (world.dbRead === 'error') return json({ code: 'XX000', message: 'secret internal detail: relation kstransfers.cycles' }, 500);
    return json(world.cycles);
  }
  if (url.startsWith('https://test-project.supabase.co/rest/v1/transfer_requests')) {
    seen.inserts.push(JSON.parse(init.body));
    if (world.dbInsert === 'duplicate') return json({ code: '23505', message: 'duplicate key value violates unique constraint "transfer_requests_one_new"' }, 409);
    if (world.dbInsert === 'error') return json({ code: '42501', message: 'permission denied for table transfer_requests (internal secret)' }, 403);
    return new Response(null, { status: 201 });
  }
  if (url.startsWith('https://kingshot.net/')) {
    seen.kingshot++;
    if (world.kingshot === 'throw') throw new TypeError('network down');
    if (world.kingshot === 'html') return new Response('<html>changed</html>', { status: 200 });
    if (world.kingshot === 'notfound') return new Response('1:{"status":"error","errorKey":"PLAYER_NOT_FOUND"}\n', { status: 200 });
    if (world.kingshot === 'invalid') return new Response('1:{"status":"error","errorKey":"INVALID_PLAYER_ID"}\n', { status: 200 });
    return new Response(RSC(world.player), { status: 200 });
  }
  if (url === 'https://discord.test/hook') {
    seen.discord.push(JSON.parse(init.body));
    if (world.discord === 'throw') throw new Error('discord down');
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected network call in test: ${url}`);
};

let lookupRoute; let request; let windows;
before(async () => {
  lookupRoute = await import('../app/api/public-lookup/route.js');
  request = await import('../app/api/request/route.js');
  windows = await import('../app/api/transfer-windows/route.js');
});
beforeEach(reset);

let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter % 250}.${Math.floor(ipCounter / 250)}`.replace(/\.\d+$/, '') + `.${ipCounter}`;
const post = (path, body, headers = {}) => new Request(`https://k1886.example.com${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', host: 'k1886.example.com', 'x-forwarded-for': nextIp(), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const read = async (res) => ({ status: res.status, body: await res.json(), text: null });
const noLeak = (s) => assert.ok(!/secret|internal|permission denied|relation|LOOKUP_ACTION_ID|Next-Action|service-role|stack|at .*\.js/i.test(JSON.stringify(s)), `leaked internals: ${JSON.stringify(s)}`);

let pidCounter = 0; // every request gets its own Player ID so the per-player limit does not carry over between tests
const goodRequest = (over = {}) => ({
  playerId: String(100000000 + (++pidCounter)), transferPasses: '7', cycleId: '11111111-1111-1111-1111-111111111111',
  lookingFor: 'Top-tier competitive alliance', contacted: true, contactedWho: 'LadySkar', contactHandle: 'Discord - j3ttybear', message: 'coming with 10 friends', ...over,
});

// =====================================================================
describe('POST /api/public-lookup', () => {
  const lookup = (id, headers) => lookupRoute.POST(post('/api/public-lookup', { playerId: id }, headers));

  test('returns only the fields the form needs', async () => {
    const r = await read(await lookup('290313686'));
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['alliance', 'ign', 'kingdom', 'power', 'truegoldGrade']);
    assert.equal(r.body.data.ign, 'j3ttybear');
    assert.equal(r.body.data.alliance, '[T86] GemstoneTavern');
  });
  test('injection-style and malformed ids never reach the lookup service', async () => {
    for (const id of ["' OR 1=1 --", '1; DROP TABLE x', '../../etc/passwd', '<script>', '12', '1'.repeat(21), '', '12 34', '１２３４', null, 123456, ['123456'], { a: 1 }]) {
      const before = seen.kingshot;
      const r = await read(await lookup(id));
      assert.ok([400].includes(r.status) || (r.status === 200 && typeof id === 'number'), `${JSON.stringify(id)} -> ${r.status}`);
      if (r.status === 400) assert.equal(seen.kingshot, before, 'upstream was called for a rejected id');
    }
  });
  test('bad bodies: invalid JSON, empty, oversize', async () => {
    assert.equal((await read(await lookupRoute.POST(post('/api/public-lookup', '{bad')))).status, 400);
    assert.equal((await read(await lookupRoute.POST(post('/api/public-lookup', '')))).status, 400);
    assert.equal((await read(await lookupRoute.POST(post('/api/public-lookup', JSON.stringify({ playerId: '1', pad: 'x'.repeat(5000) }))))).status, 413);
  });
  test('refuses a cross-site browser request, allows same-site and header-less clients', async () => {
    assert.equal((await lookup('290313686', { origin: 'https://evil.test' })).status, 403);
    assert.equal((await lookup('290313686', { origin: 'https://k1886.example.com' })).status, 200);
    assert.equal((await lookup('290313686')).status, 200);
  });
  test('rate limits one address after 10 lookups a minute, but not others', async () => {
    const ip = '198.51.100.7';
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await lookup('290313686', { 'x-forwarded-for': ip })).status);
    assert.deepEqual(codes.slice(0, 10).every((c) => c === 200), true);
    assert.deepEqual(codes.slice(10), [429, 429]);
    assert.equal((await lookup('290313686', { 'x-forwarded-for': '198.51.100.8' })).status, 200);
  });
  test('failures tell the visitor nothing about our internals', async () => {
    world.kingshot = 'notfound';
    let r = await read(await lookup('290313686'));
    assert.equal(r.status, 404); noLeak(r.body);
    world.kingshot = 'invalid';
    r = await read(await lookup('290313686'));
    assert.equal(r.status, 404); noLeak(r.body);
    world.kingshot = 'html';
    r = await read(await lookup('290313686'));
    assert.equal(r.status, 502); noLeak(r.body);
    world.kingshot = 'throw';
    r = await read(await lookup('290313686'));
    assert.equal(r.status, 502); noLeak(r.body);
  });
  test('only POST is allowed', () => {
    assert.equal(lookupRoute.GET, undefined);
    assert.equal(lookupRoute.PUT, undefined);
    assert.equal(lookupRoute.DELETE, undefined);
  });
});

// =====================================================================
describe('GET /api/transfer-windows', () => {
  const get = (headers = {}) => windows.GET(new Request('https://k1886.example.com/api/transfer-windows', { headers: { 'x-forwarded-for': nextIp(), ...headers } }));

  test('lists open cycles by name only, plus the next-window label', async () => {
    const r = await read(await get());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.windows, [{ id: '11111111-1111-1111-1111-111111111111', name: 'Transfer 9 - Nov. 8-14, 2026' }]);
    assert.deepEqual(r.body.next, { label: 'Next window (Transfer 10)' });
    const text = JSON.stringify(r.body);
    for (const hidden of ['start_date', 'end_date', 'status', 'ordinary_slots', 'afterDate', 'archived', 'Transfer 8']) assert.ok(!text.includes(hidden), `exposes ${hidden}`);
  });
  test('reads the cycles with the server-side key in the kstransfers schema', async () => {
    await get();
    const h = seen.dbHeaders[0];
    assert.equal(h['Accept-Profile'] ?? h.get?.('Accept-Profile'), 'kstransfers');
  });
  test('a database failure gives a generic error with no internals', async () => {
    world.dbRead = 'error';
    const r = await read(await get());
    assert.equal(r.status, 500); noLeak(r.body);
  });
  test('rate limited per address', async () => {
    const codes = [];
    for (let i = 0; i < 33; i++) codes.push((await get({ 'x-forwarded-for': '198.51.100.99' })).status);
    assert.equal(codes.slice(0, 30).every((c) => c === 200), true);
    assert.equal(codes[32], 429);
  });
  test('503 (not a crash) when the server key is missing', async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try { assert.equal((await get()).status, 503); } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = saved; }
  });
});

// =====================================================================
describe('POST /api/request', () => {
  const send = (body, headers) => request.POST(post('/api/request', body, headers));

  test('saves a request with player details taken from the server-side lookup', async () => {
    const r = await read(await send(goodRequest({ ign: 'Fake', kingdom: 1, power: 1 })));
    assert.equal(r.status, 200);
    assert.equal(seen.inserts.length, 1);
    const row = seen.inserts[0];
    assert.equal(row.ign, 'j3ttybear');
    assert.equal(row.kingdom, 1886);
    assert.equal(row.power, 153789982);
    assert.equal(row.current_alliance, '[T86] GemstoneTavern');
    assert.equal(row.truegold_grade, 'TG3');
    assert.equal(row.transfer_passes, 7);
    assert.equal(row.cycle_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(row.transfer_window, 'Transfer 9 - Nov. 8-14, 2026');
    assert.equal(row.after_date, null);
    assert.equal('status' in row, false, 'a visitor cannot set the status');
    assert.equal('id' in row, false);
  });
  test('"next window" is stored as an after_date, never a client-supplied value', async () => {
    const r = await read(await send(goodRequest({ cycleId: 'next', afterDate: '1999-01-01', after_date: '1999-01-01' })));
    assert.equal(r.status, 200);
    assert.equal(seen.inserts[0].cycle_id, null);
    assert.equal(seen.inserts[0].after_date, '2026-11-08');
    assert.equal(seen.inserts[0].transfer_window, 'Next window (Transfer 10)');
  });
  test('a closed, archived or made-up window is refused and nothing is saved', async () => {
    for (const cycleId of ['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', "' OR 1=1 --", '', undefined]) {
      const r = await read(await send(goodRequest({ cycleId })));
      assert.equal(r.status, 400, String(cycleId));
    }
    assert.equal(seen.inserts.length, 0);
  });
  test('SQL / HTML payloads in every text field are saved as inert text, in one parameterised insert', async () => {
    const evil = "'); DROP TABLE kstransfers.transfer_requests; -- <script>alert(1)</script>";
    const r = await read(await send(goodRequest({ contactedWho: evil, contactHandle: evil, message: evil })));
    assert.equal(r.status, 200);
    assert.equal(seen.inserts.length, 1);
    assert.equal(typeof seen.inserts[0].message, 'string');
    assert.ok(seen.inserts[0].message.includes('DROP TABLE'), 'kept as data');
    assert.equal(Object.keys(seen.inserts[0]).every((k) => /^[a-z_0-9]+$/.test(k)), true, 'no client-controlled column names');
  });
  test('rejects injection in ids and numbers before any lookup or save', async () => {
    for (const body of [goodRequest({ playerId: "1' OR '1'='1" }), goodRequest({ transferPasses: '1; DROP TABLE x' }), goodRequest({ lookingFor: 'x' })]) {
      assert.equal((await read(await send(body))).status, 400);
    }
    assert.equal(seen.inserts.length, 0);
    assert.equal(seen.kingshot, 0);
  });
  test('control and direction-override characters are stripped from stored text', async () => {
    await send(goodRequest({ message: 'hi\u0000‮ there', contactedWho: 'a\r\nb' }));
    assert.ok(!/[\u0000-\u001f‮]/.test(seen.inserts[0].message));
    assert.ok(!/[\r\n]/.test(seen.inserts[0].contacted_who));
  });
  test('text from the player lookup is cleaned too', async () => {
    world.player = { ...world.player, name: 'Evil‮\r\nName', alliance: { name: 'A\u0000B', abbr: 'X' } };
    await send(goodRequest());
    assert.ok(!/[\u0000-\u001f‮]/.test(seen.inserts[0].ign));
    assert.ok(!/[\u0000-\u001f]/.test(seen.inserts[0].current_alliance));
  });
  test('a nonsense value from the lookup cannot break the row', async () => {
    world.player = { ...world.player, kingdom: 'abc', power: 'lots' };
    const r = await read(await send(goodRequest()));
    assert.equal(r.status, 200);
    assert.equal(seen.inserts[0].kingdom, null);
    assert.equal(seen.inserts[0].power, 0);
  });
  test('refuses cross-site browser requests', async () => {
    assert.equal((await send(goodRequest(), { origin: 'https://evil.test' })).status, 403);
    assert.equal(seen.inserts.length, 0);
  });
  test('refuses oversize and malformed bodies', async () => {
    assert.equal((await read(await send(goodRequest({ message: 'x'.repeat(20000) })))).status, 413);
    assert.equal((await read(await send('not json'))).status, 400);
    assert.equal((await read(await send('null'))).status, 400);
    assert.equal(seen.inserts.length, 0);
  });
  test('a duplicate waiting request gives a friendly 409', async () => {
    world.dbInsert = 'duplicate';
    const r = await read(await send(goodRequest()));
    assert.equal(r.status, 409); noLeak(r.body);
  });
  test('database failures give a generic 500 with no internals', async () => {
    world.dbInsert = 'error';
    let r = await read(await send(goodRequest()));
    assert.equal(r.status, 500); noLeak(r.body);
    world.dbRead = 'error';
    r = await read(await send(goodRequest()));
    assert.equal(r.status, 500); noLeak(r.body);
  });
  test('lookup failures are generic and save nothing', async () => {
    for (const mode of ['notfound', 'invalid', 'html', 'throw']) {
      world.kingshot = mode;
      const r = await read(await send(goodRequest()));
      assert.ok([404, 502].includes(r.status), mode); noLeak(r.body);
    }
    assert.equal(seen.inserts.length, 0);
  });
  test('limits one address to 5 requests per 10 minutes', async () => {
    const ip = '198.51.100.50';
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await send(goodRequest({ playerId: String(500000 + i) }), { 'x-forwarded-for': ip })).status);
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.deepEqual(codes.slice(5), [429, 429]);
  });
  test('limits one Player ID to 3 requests a day, whoever sends them', async () => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await send(goodRequest({ playerId: '777000999' }))).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
  test('notifies Discord with escaped text, the site link and no mentions allowed', async () => {
    await send(goodRequest({ playerId: '600000001', message: '@everyone [free nitro](https://evil.test)' }));
    assert.equal(seen.discord.length, 1);
    const d = seen.discord[0];
    assert.deepEqual(d.allowed_mentions, { parse: [] });
    assert.ok(d.content.includes('<https://k1886.example.com/portal/requests>'));
    assert.ok(d.content.includes('Check incoming transfers here'));
    assert.ok(!d.content.includes('](https://evil.test'));
    assert.ok(!/(^|[^\\])@everyone/.test(d.content));
  });
  test('a Discord outage does not fail the request', async () => {
    world.discord = 'throw';
    const r = await read(await send(goodRequest({ playerId: '600000002' })));
    assert.equal(r.status, 200);
  });
  test('the link in the notification comes from configuration, not the Host header', async () => {
    await send(goodRequest({ playerId: '600000003' }), { host: 'evil.test', 'x-forwarded-host': 'evil.test' });
    assert.ok(seen.discord.at(-1).content.includes('https://k1886.example.com/portal/requests'));
    assert.ok(!seen.discord.at(-1).content.includes('evil.test'));
  });
  test('503 (not a crash) when the server key is missing, and nothing is attempted', async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      assert.equal((await send(goodRequest())).status, 503);
      assert.equal(seen.inserts.length, 0);
    } finally { process.env.SUPABASE_SERVICE_ROLE_KEY = saved; }
  });
  test('only POST is allowed', () => {
    assert.equal(request.GET, undefined);
    assert.equal(request.PUT, undefined);
    assert.equal(request.DELETE, undefined);
  });
});
