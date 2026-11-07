// Shared by the public request form, the API route and the tests. No React/Next imports.

// The transfer windows a visitor can pick are the portal's own active cycles (see /api/transfer-windows).
// "Not sure yet" is always offered; its dropdown value is UNSURE.
// "Next window" is the window after the latest open cycle, which may not exist yet (see after_date in the migration).
export const NOT_SURE = 'Not sure yet';
export const UNSURE = 'unsure';
export const NEXT = 'next';

export const LOOKING_FOR = [
  'Top-tier competitive alliance',
  'Active, mid-tier alliance',
  'Casual / relaxed alliance',
  'Peaceful farming alliance',
  'Not sure, open to suggestions',
];

export const MAX_PASSES = 99;

// Text from visitors (or from the player lookup) is stored and shown as plain text. Control characters and invisible
// direction/zero-width characters (used to disguise text) are replaced, and the length is capped.
export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ').trim().slice(0, max);

// A Player ID as text. Only a string or a whole number counts: an array, object or boolean that would
// happen to print like an id (["123456"]) is not accepted as one.
export function idText(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  return '';
}

// Returns { ok: true, value } or { ok: false, error }. Player details (ign, kingdom, power) are NOT taken
// from the client; the server fills them from its own lookup.
// windows: the cycles currently open for requests, [{ id, name }], loaded by the server.
// next: { label, afterDate } describing the "next window" option, or null when it is not offered.
export function validateRequest(body, windows = [], next = null) {
  // checked as sent: cutting an over-long value down first would let "1234...(21 digits)" pass as its first 20
  const playerId = idText(body?.playerId);
  if (!/^\d{3,20}$/.test(playerId)) return { ok: false, error: 'Enter a valid numeric Player ID' };

  const passesRaw = String(body?.transferPasses ?? '').trim();
  if (!/^\d{1,2}$/.test(passesRaw) || Number(passesRaw) > MAX_PASSES) {
    return { ok: false, error: `Transfer passes must be a number from 0 to ${MAX_PASSES}` };
  }

  const cycleId = clean(body?.cycleId, 40);
  let cycle = null;
  let wantsNext = false;
  if (cycleId === NEXT && next) {
    wantsNext = true;
  } else if (cycleId !== UNSURE) {
    cycle = windows.find((w) => w.id === cycleId) ?? null;
    if (!cycle) return { ok: false, error: 'Choose a transfer window' };
  }

  const lookingFor = clean(body?.lookingFor, 80);
  if (!LOOKING_FOR.includes(lookingFor)) return { ok: false, error: 'Choose what kind of alliance you are looking for' };

  const contacted = body?.contacted === true;
  const contactedWho = contacted ? clean(body?.contactedWho, 60) : '';
  if (contacted && !contactedWho) return { ok: false, error: 'Tell us who from 1886 you spoke with' };

  return {
    ok: true,
    value: {
      player_id: playerId,
      transfer_passes: Number(passesRaw),
      transfer_window: (wantsNext ? next.label : cycle ? cycle.name : NOT_SURE).slice(0, 80),
      cycle_id: cycle ? cycle.id : null,
      after_date: wantsNext ? next.afterDate : null,
      looking_for: lookingFor,
      contacted_1886: contacted,
      contacted_who: contactedWho || null,
      contact_handle: clean(body?.contactHandle, 60) || null,
      message: clean(body?.message, 500) || null,
    },
  };
}

// Text for the notification (Discord / email) and the prospect notes when a request is accepted
export function requestSummary(r) {
  return [
    `${r.ign} (ID ${r.player_id})${r.kingdom ? ` from Kingdom ${r.kingdom}` : ''}`,
    `Passes: ${r.transfer_passes} · Window: ${r.transfer_window}`,
    `Looking for: ${r.looking_for}`,
    r.contacted_1886 ? `Spoke with: ${r.contacted_who}` : 'Not yet in contact with 1886',
    r.contact_handle ? `Contact: ${r.contact_handle}` : null,
    r.message ? `Note: ${r.message}` : null,
  ].filter(Boolean).join('\n');
}

// Discord renders markdown, links and mentions in a message. Visitor text is escaped so a note cannot add a fake
// link, formatting or a ping (mentions are also switched off in the webhook call).
export function escapeDiscord(text) {
  return String(text ?? '').replace(/[\\*_~|`>[\]()<@#:]/g, '\\$&');
}
