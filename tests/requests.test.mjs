import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, LOOKING_FOR, UNSURE, NOT_SURE } from '../lib/requests.js';

const WINDOWS = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Transfer 9 - Nov. 8-14, 2026' }];
const base = { playerId: '290313686', transferPasses: '3', cycleId: WINDOWS[0].id, lookingFor: LOOKING_FOR[0], contacted: false };

test('accepts a valid request and links it to the chosen cycle', () => {
  const r = validateRequest(base, WINDOWS);
  assert.equal(r.ok, true);
  assert.equal(r.value.transfer_passes, 3);
  assert.equal(r.value.contacted_who, null);
  assert.equal(r.value.cycle_id, WINDOWS[0].id);
  assert.equal(r.value.transfer_window, 'Transfer 9 - Nov. 8-14, 2026');
});
test('"not sure yet" needs no cycle', () => {
  const r = validateRequest({ ...base, cycleId: UNSURE }, []);
  assert.equal(r.ok, true);
  assert.equal(r.value.cycle_id, null);
  assert.equal(r.value.transfer_window, NOT_SURE);
});
test('rejects a cycle that is not open, an empty choice, and the old free-text field', () => {
  assert.equal(validateRequest({ ...base, cycleId: '22222222-2222-2222-2222-222222222222' }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, cycleId: '' }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, cycleId: undefined, transferWindow: 'made up' }, WINDOWS).ok, false);
  assert.equal(validateRequest(base, []).ok, false);
});
test('rejects bad player id, passes and alliance type', () => {
  assert.equal(validateRequest({ ...base, playerId: 'abc' }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, transferPasses: '-1' }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, transferPasses: '100' }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, lookingFor: 'x' }, WINDOWS).ok, false);
});
test('requires who they spoke to when contacted', () => {
  assert.equal(validateRequest({ ...base, contacted: true }, WINDOWS).ok, false);
  assert.equal(validateRequest({ ...base, contacted: true, contactedWho: 'Bob' }, WINDOWS).value.contacted_who, 'Bob');
});
test('strips control characters and caps length', () => {
  const r = validateRequest({ ...base, message: 'hi\u0000\nthere' + 'x'.repeat(600) }, WINDOWS);
  assert.equal(r.value.message.length, 500);
  assert.ok(!/[\u0000-\u001f]/.test(r.value.message));
});

import { buildWindowOptions } from '../lib/openCycles.js';
import { NEXT } from '../lib/requests.js';

const cyc = (n, start, end, status = 'active') => ({ id: `id-${n}`, name: `Transfer ${n} - x`, status, start_date: start, end_date: end });

test('"next window" is stored as an after_date and needs no cycle', () => {
  const next = { label: 'Next window (Transfer 10)', afterDate: '2026-11-08' };
  const r = validateRequest({ ...base, cycleId: NEXT }, WINDOWS, next);
  assert.equal(r.ok, true);
  assert.equal(r.value.cycle_id, null);
  assert.equal(r.value.after_date, '2026-11-08');
  assert.equal(r.value.transfer_window, 'Next window (Transfer 10)');
  assert.equal(validateRequest({ ...base, cycleId: NEXT }, WINDOWS, null).ok, false); // not offered
  assert.equal(validateRequest(base, WINDOWS).value.after_date, null);
});

test('window options: open cycles soonest first, next window numbered after the highest cycle', () => {
  const cycles = [cyc(8, '2026-09-13', '2026-09-19'), cyc(9, '2026-11-08', '2026-11-14'), cyc(7, '2026-07-19', '2026-07-25', 'archived')];
  const o = buildWindowOptions(cycles, '2026-11-10');
  assert.deepEqual(o.windows.map((w) => w.id), ['id-9']); // 8 has ended, 7 is archived
  assert.deepEqual(o.next, { label: 'Next window (Transfer 10)', afterDate: '2026-11-08' });
});

test('window options with nothing open: afterDate is today', () => {
  const o = buildWindowOptions([cyc(8, '2026-09-13', '2026-09-19')], '2026-11-10');
  assert.deepEqual(o.windows, []);
  assert.equal(o.next.afterDate, '2026-11-10');
});
