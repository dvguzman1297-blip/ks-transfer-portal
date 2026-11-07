// Unit tests for the shared helpers: HTTP guards, rate limiter, text cleaning, notifications and request validation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, readJson, sameOrigin, siteOrigin } from '../lib/http.js';
import { makeLimiter, publicLookupError } from '../lib/playerLookup.js';
import { clean, escapeDiscord, requestSummary, validateRequest, LOOKING_FOR, UNSURE, NEXT, NOT_SURE } from '../lib/requests.js';
import { discordContent, notifyOutside } from '../lib/notify.js';
import { buildWindowOptions } from '../lib/openCycles.js';

const req = (headers = {}, body, method = 'POST') => new Request('http://localhost/api/x', { method, headers, body });
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

describe('clientIp', () => {
  test('uses the first x-forwarded-for entry, then x-real-ip, then "unknown"', () => {
    assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
    assert.equal(clientIp(req({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
    assert.equal(clientIp(req()), 'unknown');
  });
});

describe('siteOrigin', () => {
  test('SITE_URL wins and loses its trailing slash', () =>
    withEnv({ SITE_URL: 'https://k1886.example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }, () =>
      assert.equal(siteOrigin(req({ host: 'evil.test' })), 'https://k1886.example.com')));
  test('the Vercel production domain is used when SITE_URL is unset (a spoofed Host is ignored)', () =>
    withEnv({ SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: 'k1886.vercel.app' }, () =>
      assert.equal(siteOrigin(req({ host: 'evil.test' })), 'https://k1886.vercel.app')));
  test('falls back to the request host, https unless localhost', () =>
    withEnv({ SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined }, () => {
      assert.equal(siteOrigin(req({ host: 'localhost:3000' })), 'http://localhost:3000');
      assert.equal(siteOrigin(req({ host: 'k1886.example.com' })), 'https://k1886.example.com');
      assert.equal(siteOrigin(req({ 'x-forwarded-host': 'a.example.com', 'x-forwarded-proto': 'https' })), 'https://a.example.com');
    }));
});

describe('readJson', () => {
  test('parses a normal body', async () => {
    const r = await readJson(req({ 'content-type': 'application/json' }, '{"a":1}'));
    assert.deepEqual(r, { ok: true, body: { a: 1 } });
  });
  test('rejects invalid JSON with 400', async () => {
    const r = await readJson(req({}, '{nope'));
    assert.equal(r.ok, false); assert.equal(r.status, 400);
  });
  test('rejects an empty body', async () => assert.equal((await readJson(req({}, ''))).status, 400));
  test('rejects a body over the limit with 413, by declared length and by real length', async () => {
    assert.equal((await readJson(req({ 'content-length': '999999' }, '{}'), 100)).status, 413);
    assert.equal((await readJson(req({}, JSON.stringify({ a: 'x'.repeat(500) })), 100)).status, 413);
  });
  test('accepts a body exactly at the limit', async () => {
    const body = JSON.stringify({ a: 'x'.repeat(10) });
    assert.equal((await readJson(req({}, body), body.length)).ok, true);
  });
  test('a JSON array or string is returned as is (callers validate the shape)', async () => {
    assert.deepEqual((await readJson(req({}, '[1]'))).body, [1]);
  });
});

describe('sameOrigin', () => {
  test('no Origin header (curl, servers) passes', () => assert.equal(sameOrigin(req({ host: 'a.test' })), true));
  test('matching Origin passes', () => assert.equal(sameOrigin(req({ origin: 'https://a.test', host: 'a.test' })), true));
  test('another site is refused', () => assert.equal(sameOrigin(req({ origin: 'https://evil.test', host: 'a.test' })), false));
  test('a lookalike host is refused', () => {
    assert.equal(sameOrigin(req({ origin: 'https://a.test.evil.test', host: 'a.test' })), false);
    assert.equal(sameOrigin(req({ origin: 'https://evil-a.test', host: 'a.test' })), false);
  });
  test('garbage and "null" origins are refused', () => {
    assert.equal(sameOrigin(req({ origin: 'null', host: 'a.test' })), false);
    assert.equal(sameOrigin(req({ origin: 'not a url', host: 'a.test' })), false);
  });
  test('x-forwarded-host is honoured, and SITE_URL is an accepted alias', () =>
    withEnv({ SITE_URL: 'https://www.a.test' }, () => {
      assert.equal(sameOrigin(req({ origin: 'https://a.test', 'x-forwarded-host': 'a.test', host: 'internal' })), true);
      assert.equal(sameOrigin(req({ origin: 'https://www.a.test', host: 'a.test' })), true);
    }));
});

describe('makeLimiter', () => {
  test('allows up to the limit, then blocks', () => {
    const limited = makeLimiter(3);
    assert.deepEqual([1, 2, 3, 4, 5].map(() => limited('ip')), [false, false, false, true, true]);
  });
  test('keys are independent', () => {
    const limited = makeLimiter(1);
    assert.equal(limited('a'), false);
    assert.equal(limited('b'), false);
    assert.equal(limited('a'), true);
  });
  test('the window slides: old hits expire', async () => {
    const limited = makeLimiter(1, 30);
    assert.equal(limited('a'), false);
    assert.equal(limited('a'), true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(limited('a'), false);
  });
  test('does not grow without bound under many distinct keys', async () => {
    const limited = makeLimiter(1, 10);
    for (let i = 0; i < 1500; i++) limited(`k${i}`);
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 50; i++) limited(`later${i}`); // triggers the cleanup pass
    assert.equal(limited('k0'), false); // an expired key is free again
  });
});

describe('clean', () => {
  test('replaces control characters and trims', () => assert.equal(clean('  a\u0000b\nc\td  ', 50), 'a b c d'));
  test('replaces invisible direction and zero-width characters', () => {
    assert.equal(clean('ab‮cd', 50), 'ab cd');
    assert.equal(clean('a​b⁦c﻿d', 50), 'a b c d');
  });
  test('caps the length and survives odd input', () => {
    assert.equal(clean('x'.repeat(100), 10).length, 10);
    assert.equal(clean(null, 10), '');
    assert.equal(clean(undefined, 10), '');
    assert.equal(clean(12345, 10), '12345');
    assert.equal(clean({ toString: () => 'obj' }, 10), 'obj');
  });
});

describe('escapeDiscord', () => {
  test('neutralises markdown, links, mentions and headers', () => {
    const out = escapeDiscord('**bold** [click](https://evil.test) @everyone <@123> `code` # head > quote ~~s~~ ||spoiler||');
    for (const raw of ['**', '](', '<@', '`code`', '||']) assert.ok(!out.includes(raw), `still contains ${raw}`);
    assert.ok(!/(^|[^\\])@everyone/.test(out), 'an unescaped @everyone is left');
    assert.ok(out.includes('\\@everyone'));
  });
  test('leaves plain text alone', () => assert.equal(escapeDiscord('Hello world 123'), 'Hello world 123'));
});

const REQ = {
  ign: 'j3ttybear', player_id: '290313686', kingdom: 1886, transfer_passes: 7, transfer_window: 'Transfer 9 - Nov. 8-14, 2026',
  looking_for: LOOKING_FOR[0], contacted_1886: true, contacted_who: 'LadySkar', contact_handle: 'Discord - j3ttybear', message: 'hello',
};

describe('requestSummary / discordContent', () => {
  test('summary lists the key facts', () => {
    const s = requestSummary(REQ);
    for (const part of ['j3ttybear', '290313686', 'Kingdom 1886', 'Passes: 7', 'LadySkar', 'Discord - j3ttybear', 'hello']) assert.ok(s.includes(part), part);
    assert.ok(requestSummary({ ...REQ, contacted_1886: false }).includes('Not yet in contact'));
  });
  test('the Discord message ends with the link even when the note is long', () => {
    const c = discordContent({ ...REQ, message: 'x'.repeat(500), contacted_who: 'y'.repeat(60) }, 'https://k1886.example.com/portal/requests');
    assert.ok(c.endsWith('Check incoming transfers here: <https://k1886.example.com/portal/requests>'));
    assert.ok(c.length < 2000, 'must fit Discord\'s 2000 character limit');
  });
  test('visitor markdown and mentions cannot form a link or ping in the message', () => {
    const c = discordContent({ ...REQ, message: '[free nitro](https://evil.test) @everyone' }, 'https://k1886.example.com/portal/requests');
    assert.ok(!c.includes('](https://evil.test'));
    assert.ok(!c.includes(' @everyone'));
  });
});

describe('notifyOutside', () => {
  const link = 'https://k1886.example.com/portal/requests';
  test('does nothing when no notification settings exist', async () => {
    const calls = [];
    await notifyOutside(REQ, link, {}, (...a) => { calls.push(a); return Promise.resolve(); });
    assert.equal(calls.length, 0);
  });
  test('posts to Discord with mentions switched off', async () => {
    const calls = [];
    await notifyOutside({ ...REQ, message: '@everyone' }, link, { DISCORD_WEBHOOK_URL: 'https://discord.test/hook' }, (u, o) => { calls.push([u, o]); return Promise.resolve(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://discord.test/hook');
    const body = JSON.parse(calls[0][1].body);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.ok(body.content.includes(link));
  });
  test('sends email with a single-line subject, only when the key and recipients exist', async () => {
    const calls = [];
    const f = (u, o) => { calls.push([u, o]); return Promise.resolve(); };
    await notifyOutside(REQ, link, { RESEND_API_KEY: 'k' }, f); // no recipients
    assert.equal(calls.length, 0);
    await notifyOutside({ ...REQ, ign: 'Evil\r\nBcc: attacker@x.test' }, link, { RESEND_API_KEY: 'k', NOTIFY_EMAIL_TO: 'a@x.test, b@x.test ,' }, f);
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0][1].body);
    assert.deepEqual(body.to, ['a@x.test', 'b@x.test']);
    assert.ok(!/[\r\n]/.test(body.subject));
    assert.equal(calls[0][1].headers.Authorization, 'Bearer k');
  });
  test('a failing webhook never throws', async () => {
    await notifyOutside(REQ, link, { DISCORD_WEBHOOK_URL: 'https://discord.test/hook' }, () => Promise.reject(new Error('down')));
  });
});

describe('publicLookupError', () => {
  test('hides internals from visitors', () => {
    for (const code of ['UPSTREAM_CHANGED', 'UPSTREAM_ERROR', 'UNREACHABLE', undefined]) {
      const e = publicLookupError({ code });
      assert.equal(e.status, 502);
      assert.ok(!/LOOKUP_ACTION_ID|Next-Action|INVALID_PLAYER_ID|RATE_LIMIT/i.test(e.error));
    }
    assert.equal(publicLookupError({ code: 'NOT_FOUND' }).status, 404);
    assert.equal(publicLookupError({ code: 'TIMEOUT' }).status, 504);
  });
});

describe('buildWindowOptions', () => {
  const c = (n, start, end, status = 'active') => ({ id: `id-${n}`, name: `Transfer ${n} - x`, status, start_date: start, end_date: end });
  test('lists open cycles soonest first and ignores archived or finished ones', () => {
    const o = buildWindowOptions([c(10, '2027-01-03', '2027-01-09'), c(9, '2026-11-08', '2026-11-14'), c(8, '2026-09-13', '2026-09-19'), c(7, '2026-07-19', '2026-07-25', 'archived')], '2026-11-10');
    assert.deepEqual(o.windows.map((w) => w.id), ['id-9', 'id-10']);
    assert.deepEqual(o.next, { label: 'Next window (Transfer 11)', afterDate: '2027-01-03' });
  });
  test('a cycle ending today is still open; one that ended yesterday is not', () => {
    assert.equal(buildWindowOptions([c(9, '2026-11-08', '2026-11-14')], '2026-11-14').windows.length, 1);
    assert.equal(buildWindowOptions([c(9, '2026-11-08', '2026-11-14')], '2026-11-15').windows.length, 0);
  });
  test('a cycle without an end date stays open', () => assert.equal(buildWindowOptions([c(9, '2026-11-08', null)], '2030-01-01').windows.length, 1));
  test('no cycles at all: next window is numbered 1 and starts from today', () => {
    const o = buildWindowOptions([], '2026-11-10');
    assert.deepEqual(o, { windows: [], next: { label: 'Next window (Transfer 1)', afterDate: '2026-11-10' } });
  });
  test('exposes only id and name for each window, and at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(i + 1, `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, '2027-12-31'));
    const o = buildWindowOptions(many, '2026-11-10');
    assert.equal(o.windows.length, 20);
    for (const w of o.windows) assert.deepEqual(Object.keys(w).sort(), ['id', 'name']);
  });
});

// ---------- validateRequest: hostile input ----------
const WINDOWS = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Transfer 9 - Nov. 8-14, 2026' }];
const NEXT_INFO = { label: 'Next window (Transfer 10)', afterDate: '2026-11-08' };
const good = { playerId: '290313686', transferPasses: '3', cycleId: WINDOWS[0].id, lookingFor: LOOKING_FOR[1], contacted: false };
const ok = (over = {}) => validateRequest({ ...good, ...over }, WINDOWS, NEXT_INFO);

describe('validateRequest: hostile input', () => {
  const SQLI = ["' OR '1'='1", "1; DROP TABLE kstransfers.cycles; --", "' UNION SELECT * FROM auth.users --", "Robert'); DELETE FROM kstransfers.members;--", '" OR ""="'];
  test('SQL-looking player ids and passes are rejected outright', () => {
    for (const p of SQLI) {
      assert.equal(ok({ playerId: p }).ok, false, `playerId ${p}`);
      assert.equal(ok({ transferPasses: p }).ok, false, `passes ${p}`);
    }
  });
  test('SQL-looking choices (window, alliance type) are rejected, not passed on', () => {
    for (const p of SQLI) {
      assert.equal(ok({ cycleId: p }).ok, false);
      assert.equal(ok({ lookingFor: p }).ok, false);
    }
  });
  test('SQL / HTML in free-text fields is kept as inert text (parameterised queries handle it) with control characters removed', () => {
    const r = ok({ contacted: true, contactedWho: "<script>alert(1)</script>'; DROP TABLE x;--\u0000", contactHandle: '"><img src=x onerror=alert(1)>', message: "'); DROP TABLE kstransfers.cycles; --" });
    assert.equal(r.ok, true);
    assert.ok(r.value.contacted_who.includes('<script>'));
    assert.ok(!r.value.contacted_who.includes('\u0000'));
    assert.equal(r.value.message, "'); DROP TABLE kstransfers.cycles; --");
  });
  test('wrong types never throw', () => {
    for (const bad of [null, undefined, 0, 1, '', 'str', [], [1, 2], {}, () => 1, true, Symbol.iterator.toString()]) {
      for (const field of ['playerId', 'transferPasses', 'cycleId', 'lookingFor', 'contactedWho', 'contactHandle', 'message']) {
        assert.doesNotThrow(() => validateRequest({ ...good, [field]: bad }, WINDOWS, NEXT_INFO), `${field} = ${String(bad)}`);
      }
    }
    assert.doesNotThrow(() => validateRequest(null, WINDOWS, NEXT_INFO));
    assert.doesNotThrow(() => validateRequest(undefined));
    assert.doesNotThrow(() => validateRequest('a string'));
    assert.doesNotThrow(() => validateRequest([1, 2, 3]));
  });
  test('an object or array as the window id is not accepted as a match', () => {
    assert.equal(ok({ cycleId: { toString: () => WINDOWS[0].id } }).ok, true); // coerced to the same plain string, still exact-matched
    assert.equal(ok({ cycleId: [WINDOWS[0].id, 'x'] }).ok, false);
    assert.equal(ok({ cycleId: { id: WINDOWS[0].id } }).ok, false);
  });
  test('prototype-pollution style bodies change nothing', () => {
    const body = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    validateRequest({ ...good, ...body }, WINDOWS, NEXT_INFO);
    assert.equal({}.polluted, undefined);
  });
  test('client-supplied player details and extra fields are ignored', () => {
    const r = ok({ ign: 'Fake', kingdom: 1, power: 999, status: 'accepted', id: 'x', cycle_id: 'evil', after_date: '1999-01-01', transfer_window: 'x' });
    assert.equal(r.ok, true);
    for (const k of ['ign', 'kingdom', 'power', 'status', 'id']) assert.equal(k in r.value, false, k);
    assert.equal(r.value.cycle_id, WINDOWS[0].id);
    assert.equal(r.value.after_date, null);
    assert.equal(r.value.transfer_window, WINDOWS[0].name);
  });
  test('every text field is length-capped', () => {
    const r = ok({ contacted: true, contactedWho: 'a'.repeat(500), contactHandle: 'b'.repeat(500), message: 'c'.repeat(5000) });
    assert.equal(r.value.contacted_who.length, 60);
    assert.equal(r.value.contact_handle.length, 60);
    assert.equal(r.value.message.length, 500);
  });
  test('passes must be a plain 0-99 integer string/number', () => {
    for (const bad of ['1.5', '-1', '100', '1e2', ' ', '0x10', '१२', '+5', '5 ']) assert.equal(ok({ transferPasses: bad }).ok, bad === '5 ', `passes ${JSON.stringify(bad)}`);
    for (const good_ of ['0', '99', 7, ' 7 ']) assert.equal(ok({ transferPasses: good_ }).ok, true);
  });
  test('player id must be 3-20 ASCII digits', () => {
    for (const bad of ['12', '1'.repeat(21), '12a', '１２３４', '12 34', '-123', '1.5']) assert.equal(ok({ playerId: bad }).ok, false, bad);
    assert.equal(ok({ playerId: '123' }).ok, true);
    assert.equal(ok({ playerId: '1'.repeat(20) }).ok, true);
  });
  test('"contacted" must be the boolean true; strings do not count', () => {
    assert.equal(ok({ contacted: 'true', contactedWho: 'x' }).value.contacted_1886, false);
    assert.equal(ok({ contacted: 1, contactedWho: 'x' }).value.contacted_1886, false);
  });
  test('the "next window" and "not sure" choices', () => {
    assert.equal(ok({ cycleId: NEXT }).value.after_date, '2026-11-08');
    assert.equal(ok({ cycleId: NEXT }).value.cycle_id, null);
    assert.equal(validateRequest({ ...good, cycleId: NEXT }, WINDOWS, null).ok, false);
    assert.equal(ok({ cycleId: UNSURE }).value.transfer_window, NOT_SURE);
  });
});
