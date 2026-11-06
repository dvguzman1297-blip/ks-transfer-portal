// Tests the /api/lookup route handler end to end with every network call mocked
// (Supabase auth, the approval check, and kingshot.net).
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Plain Node can't resolve the extensionless "next/server" import that Next's bundler handles itself.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';

// ---- scenario the mocked network will play back ----
const scenario = {};
const calls = { kingshot: [] };
let userCounter = 0;

function reset() {
  scenario.authOk = true;
  scenario.approved = true;
  scenario.userId = `user-${++userCounter}`;
  scenario.kingshot = 'success';
  calls.kingshot = [];
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const RSC_OK = (player) => `0:{"a":"$@1","f":"","q":"","i":false,"b":"x"}\n1:${JSON.stringify({ status: 'success', player })}\n`;
const PLAYER = {
  playerId: '290313686', name: 'j3ttybear', kingdom: 1886, level: 45, levelLabel: 'TG3', power: '153789982',
  alliance: { id: 'yJIxR9ipEA', name: 'GemstoneTavern', abbr: 'T86' },
};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;

  if (url.includes('/auth/v1/user')) {
    if (!scenario.authOk) return json({ code: 401, msg: 'invalid JWT' }, 401);
    return json({ id: scenario.userId, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  }
  if (url.includes('/rest/v1/rpc/is_approved')) return json(scenario.approved);

  if (url.startsWith('https://kingshot.net/')) {
    calls.kingshot.push({ url, init });
    if (scenario.kingshot === 'throw') throw new TypeError('network down');
    if (scenario.kingshot === 'html') return new Response('<html>blocked</html>', { status: 200 });
    if (scenario.kingshot === 'notfound') return new Response('0:{"a":"$@1"}\n1:{"status":"error","errorKey":"PLAYER_NOT_FOUND"}\n', { status: 200 });
    if (scenario.kingshot === 'noalliance') return new Response(RSC_OK({ ...PLAYER, alliance: null }), { status: 200 });
    if (scenario.kingshot === 'othererror') return new Response('1:{"status":"error","errorKey":"RATE_LIMIT"}\n', { status: 200 });
    return new Response(RSC_OK(PLAYER), { status: 200 });
  }
  throw new Error(`Unexpected network call in test: ${url}`);
};

let POST;
before(async () => {
  ({ POST } = await import('../app/api/lookup/route.js'));
});
beforeEach(reset);

const call = (body, { token = 'good-token', raw } = {}) =>
  POST(new Request('http://localhost/api/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? JSON.stringify(body),
  }));
const read = async (res) => ({ status: res.status, body: await res.json() });

describe('access control', () => {
  test('rejects requests with no token', async () => {
    const { status, body } = await read(await call({ playerId: '290313686' }, { token: null }));
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.equal(calls.kingshot.length, 0, 'must not hit kingshot.net when unauthenticated');
  });
  test('rejects an invalid or expired token', async () => {
    scenario.authOk = false;
    const { status } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 401);
    assert.equal(calls.kingshot.length, 0);
  });
  test('rejects signed-in users who are not approved', async () => {
    scenario.approved = false;
    const { status, body } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 403);
    assert.match(body.error, /not approved/i);
    assert.equal(calls.kingshot.length, 0);
  });
});

describe('input validation', () => {
  test('rejects a body that is not JSON', async () => {
    const { status } = await read(await call(null, { raw: 'not json{' }));
    assert.equal(status, 400);
  });
  test('rejects ids that are not plain numbers', async () => {
    for (const bad of ['abc', '12', '', null, undefined, '12345678 OR 1=1', "1'; DROP TABLE x;--", '../../etc/passwd', '<script>', '1'.repeat(25)]) {
      const { status } = await read(await call({ playerId: bad }));
      assert.equal(status, 400, `playerId ${JSON.stringify(bad)} should be rejected`);
    }
    assert.equal(calls.kingshot.length, 0, 'invalid ids must never reach kingshot.net');
  });
  test('accepts numeric ids, including numbers and padded strings', async () => {
    assert.equal((await call({ playerId: 290313686 })).status, 200);
    assert.equal((await call({ playerId: ' 290313686 ' })).status, 200);
  });
});

describe('lookup behaviour', () => {
  test('maps the player profile to the response shape', async () => {
    const { status, body } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 200);
    assert.deepEqual(body, {
      success: true,
      data: { ign: 'j3ttybear', kingdom: 1886, power: '153789982', alliance: '[T86] GemstoneTavern', truegoldGrade: 'TG3' },
    });
  });
  test('sends the expected request to kingshot.net', async () => {
    await call({ playerId: '290313686' });
    assert.equal(calls.kingshot.length, 1);
    const { url, init } = calls.kingshot[0];
    assert.equal(url, 'https://kingshot.net/gift-codes/redeem');
    assert.equal(init.method, 'POST');
    assert.equal(init.body, '["290313686"]');
    assert.ok(init.headers['Next-Action'], 'must send the Next-Action header');
    assert.equal(init.headers.Accept, 'text/x-component');
  });
  test('handles players without an alliance', async () => {
    scenario.kingshot = 'noalliance';
    const { body } = await read(await call({ playerId: '290313686' }));
    assert.equal(body.success, true);
    assert.equal(body.data.alliance, null);
  });
  test('returns 404 for an unknown player', async () => {
    scenario.kingshot = 'notfound';
    const { status, body } = await read(await call({ playerId: '999999999' }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Player not found');
  });
  test('reports a changed upstream page clearly (outdated Next-Action id)', async () => {
    scenario.kingshot = 'html';
    const { status, body } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 502);
    assert.match(body.error, /LOOKUP_ACTION_ID/);
  });
  test('reports other upstream errors without crashing', async () => {
    scenario.kingshot = 'othererror';
    const { status, body } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 502);
    assert.match(body.error, /RATE_LIMIT/);
  });
  test('returns 502 when kingshot.net is unreachable', async () => {
    scenario.kingshot = 'throw';
    const { status, body } = await read(await call({ playerId: '290313686' }));
    assert.equal(status, 502);
    assert.equal(body.success, false);
  });
  test('never leaks internals in error responses', async () => {
    scenario.kingshot = 'throw';
    const { body } = await read(await call({ playerId: '290313686' }));
    assert.doesNotMatch(JSON.stringify(body), /network down|stack|TypeError|supabase\.co/i);
  });
});

describe('rate limiting', () => {
  test('allows 30 lookups a minute per user, then returns 429', async () => {
    scenario.userId = 'rate-limit-user';
    const statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await call({ playerId: '290313686' })).status);
    assert.equal(statuses.slice(0, 30).every((s) => s === 200), true);
    assert.equal(statuses[30], 429);
    assert.equal(statuses[31], 429);
  });
  test('limits are per user, not global', async () => {
    scenario.userId = 'rate-limit-user'; // already exhausted by the previous test
    assert.equal((await call({ playerId: '290313686' })).status, 429);
    scenario.userId = 'a-different-user';
    assert.equal((await call({ playerId: '290313686' })).status, 200);
  });
});
