import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, TRANSFER_WINDOWS, LOOKING_FOR } from '../lib/requests.js';

const base = { playerId: '290313686', transferPasses: '3', transferWindow: TRANSFER_WINDOWS[0], lookingFor: LOOKING_FOR[0], contacted: false };

test('accepts a valid request', () => {
  const r = validateRequest(base);
  assert.equal(r.ok, true);
  assert.equal(r.value.transfer_passes, 3);
  assert.equal(r.value.contacted_who, null);
});
test('rejects bad player id, passes, window and alliance type', () => {
  assert.equal(validateRequest({ ...base, playerId: 'abc' }).ok, false);
  assert.equal(validateRequest({ ...base, transferPasses: '-1' }).ok, false);
  assert.equal(validateRequest({ ...base, transferPasses: '100' }).ok, false);
  assert.equal(validateRequest({ ...base, transferWindow: 'made up' }).ok, false);
  assert.equal(validateRequest({ ...base, lookingFor: 'x' }).ok, false);
});
test('requires who they spoke to when contacted', () => {
  assert.equal(validateRequest({ ...base, contacted: true }).ok, false);
  assert.equal(validateRequest({ ...base, contacted: true, contactedWho: 'Bob' }).value.contacted_who, 'Bob');
});
test('strips control characters and caps length', () => {
  const r = validateRequest({ ...base, message: 'hi\u0000\nthere' + 'x'.repeat(600) });
  assert.equal(r.value.message.length, 500);
  assert.ok(!/[\u0000-\u001f]/.test(r.value.message));
});
