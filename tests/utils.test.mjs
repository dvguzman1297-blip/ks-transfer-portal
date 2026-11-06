import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePower, fmtShort, fmt, digits, csvSafe, clip, toCSV, parseCSV, normalizeImportRows,
  isFollowUp, isUnassigned, parseLocalDate, isoDate, freshCycle, rangeLabel, cycleCountdown,
  MAX_IMPORT_ROWS, STATUSES, slotInt, inviteUsage, SLOT_PRESETS, templateCSV, TEMPLATE_MARK, CSV_COLS,
} from '../lib/utils.js';

describe('parsePower', () => {
  test('understands K / M / B suffixes', () => {
    assert.equal(parsePower('153.8M'), 153800000);
    assert.equal(parsePower('1.2B'), 1200000000);
    assert.equal(parsePower('500K'), 500000);
    assert.equal(parsePower('2b'), 2000000000);
  });
  test('understands plain and comma-formatted numbers', () => {
    assert.equal(parsePower('120,500,000'), 120500000);
    assert.equal(parsePower('153789982'), 153789982);
    assert.equal(parsePower(1234.6), 1235);
  });
  test('never returns NaN or negatives for junk', () => {
    for (const bad of ['', null, undefined, 'abc', '--', '12.5.3', NaN, {}]) {
      const v = parsePower(bad);
      assert.ok(Number.isFinite(v) && v >= 0, `parsePower(${String(bad)}) -> ${v}`);
    }
    assert.equal(parsePower(''), 0);
    assert.equal(parsePower('abc'), 0);
  });
});

describe('number formatting', () => {
  test('fmtShort', () => {
    assert.equal(fmtShort(0), '0');
    assert.equal(fmtShort(999), '999');
    assert.equal(fmtShort(1000), '1K');
    assert.equal(fmtShort(1500000), '1.5M');
    assert.equal(fmtShort(153789982), '153.8M');
    assert.equal(fmtShort(2e9), '2.00B');
    assert.equal(fmtShort(null), '0');
  });
  test('fmt adds thousands separators and blanks empties', () => {
    assert.equal(fmt(1234567), '1,234,567');
    assert.equal(fmt(null), '');
    assert.equal(fmt(''), '');
  });
  test('digits strips everything but digits', () => {
    assert.equal(digits('12a-3 4'), '1234');
    assert.equal(digits(null), '');
  });
});

describe('CSV safety', () => {
  test('csvSafe neutralises spreadsheet formulas', () => {
    for (const evil of ['=1+1', '+63917', '-5', '@SUM(A1)', '\tcmd', '=HYPERLINK("http://x")']) {
      assert.equal(csvSafe(evil), `'${evil}`);
    }
    assert.equal(csvSafe('normal'), 'normal');
    assert.equal(csvSafe(12345), 12345); // numbers are left alone
  });

  test('toCSV writes a header and escapes commas, quotes and newlines', () => {
    const csv = toCSV([{ player_id: '123', ign: 'Say "hi", ok', notes: 'line1\nline2', power: 5 }]);
    const [header, ...rest] = csv.split('\n');
    assert.ok(header.startsWith('player_id,ign,kingdom,power'));
    assert.ok(rest.join('\n').includes('"Say ""hi"", ok"'));
    assert.ok(rest.join('\n').includes('"line1\nline2"'));
  });

  test('toCSV guards formulas in every text cell', () => {
    const csv = toCSV([{ player_id: '123', ign: '=cmd|calc', notes: '+63 912', recruiter: '@x' }]);
    assert.ok(csv.includes("'=cmd|calc"));
    assert.ok(csv.includes("'+63 912"));
    assert.ok(csv.includes("'@x"));
  });

  test('toCSV leaves null/undefined cells empty', () => {
    const line = toCSV([{ player_id: '123', ign: 'A' }]).split('\n')[1];
    assert.equal(line.split(',').length, 11);
  });
});

describe('parseCSV', () => {
  test('parses a simple file with case-insensitive headers', () => {
    const rows = parseCSV('Player_ID,IGN\n111,Alpha\n222,Beta');
    assert.deepEqual(rows, [{ player_id: '111', ign: 'Alpha' }, { player_id: '222', ign: 'Beta' }]);
  });
  test('handles quotes, commas, escaped quotes and newlines inside cells', () => {
    const rows = parseCSV('a,b\n"x, y","he said ""hi"""\n"multi\nline",z');
    assert.equal(rows[0].a, 'x, y');
    assert.equal(rows[0].b, 'he said "hi"');
    assert.equal(rows[1].a, 'multi\nline');
  });
  test('handles CRLF line endings and a BOM', () => {
    const rows = parseCSV('﻿a,b\r\n1,2\r\n3,4\r\n');
    assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });
  test('returns [] for empty or header-only input', () => {
    assert.deepEqual(parseCSV(''), []);
    assert.deepEqual(parseCSV('a,b\n'), []);
  });
  test('skips blank lines', () => {
    assert.equal(parseCSV('a\n1\n\n\n2\n').length, 2);
  });
  test('round-trips through toCSV (formula guard aside)', () => {
    const src = [{ player_id: '123', ign: 'Name, with "quotes"', kingdom: 1886, power: 153789982, status: 'In Talks', notes: 'a\nb' }];
    const back = parseCSV(toCSV(src))[0];
    assert.equal(back.ign, 'Name, with "quotes"');
    assert.equal(back.power, '153789982');
    assert.equal(back.notes, 'a\nb');
  });
});

describe('clip', () => {
  test('trims, caps length and strips control characters', () => {
    assert.equal(clip('  hello  ', 10), 'hello');
    assert.equal(clip('abcdef', 3), 'abc');
    assert.equal(clip('a\u0000b\u0007c', 10), 'abc');
    assert.equal(clip(null, 5), '');
    assert.equal(clip(undefined, 5), '');
  });
  test('keeps normal whitespace characters inside text', () => {
    assert.equal(clip('a\nb\tc', 10), 'a\nb\tc');
  });
});

describe('normalizeImportRows', () => {
  const good = { player_id: '290313686', ign: 'j3ttybear', kingdom: '1886', power: '153.8M', status: 'Committed', invite_type: 'open' };

  test('maps a valid row', () => {
    const [r] = normalizeImportRows([good], 'cycle-1');
    assert.equal(r.cycle_id, 'cycle-1');
    assert.equal(r.player_id, '290313686');
    assert.equal(r.kingdom, 1886);
    assert.equal(r.power, 153800000);
    assert.equal(r.status, 'Committed');
    assert.equal(r.invite_type, 'Open'); // case-insensitive match, canonical value
  });
  test('accepts the playerId alias', () => {
    assert.equal(normalizeImportRows([{ playerId: '12345', ign: 'x' }], 'c')[0].player_id, '12345');
  });
  test('drops rows with a bad player id or no name', () => {
    const rows = normalizeImportRows([
      good,
      { player_id: 'abc', ign: 'letters' },
      { player_id: '12', ign: 'too short' },
      { player_id: '123456789012345678901', ign: 'too long' },
      { player_id: '555', ign: '' },
      { player_id: "1'; DROP TABLE x;--", ign: 'sqli' },
    ], 'c');
    assert.equal(rows.length, 1);
  });
  test('ignores non-object entries', () => {
    assert.equal(normalizeImportRows([null, 5, 'x', good], 'c').length, 1);
  });
  test('defaults unknown status and invite type safely', () => {
    const [r] = normalizeImportRows([{ ...good, status: 'Hacked', invite_type: 'VIP' }], 'c');
    assert.equal(r.status, STATUSES[0]);
    assert.equal(r.invite_type, null);
  });
  test('only accepts a realistic kingdom number', () => {
    for (const [k, want] of [['0', null], ['-5', null], ['100000', null], ['abc', null], ['1', 1], ['99999', 99999]]) {
      assert.equal(normalizeImportRows([{ ...good, kingdom: k }], 'c')[0].kingdom, want, `kingdom ${k}`);
    }
  });
  test('truncates oversized text to the database limits', () => {
    const [r] = normalizeImportRows([{ ...good, ign: 'x'.repeat(500), notes: 'n'.repeat(5000), alliance: 'a'.repeat(500), recruiter: 'r'.repeat(500), assigned_alliance: 'z'.repeat(500), truegold_grade: 't'.repeat(500) }], 'c');
    assert.equal(r.ign.length, 60);
    assert.equal(r.notes.length, 2000);
    assert.equal(r.alliance.length, 80);
    assert.equal(r.recruiter.length, 60);
    assert.equal(r.assigned_alliance.length, 40);
    assert.equal(r.truegold_grade.length, 20);
  });
  test('stores injection-looking text as inert data', () => {
    const [r] = normalizeImportRows([{ ...good, ign: "Robert'); DROP TABLE prospects;--", notes: '<script>alert(1)</script>' }], 'c');
    assert.equal(r.ign, "Robert'); DROP TABLE prospects;--");
    assert.equal(r.notes, '<script>alert(1)</script>');
  });
  test('rejects too many rows and empty/invalid input', () => {
    assert.throws(() => normalizeImportRows(new Array(MAX_IMPORT_ROWS + 1).fill(good), 'c'), /Too many rows/);
    assert.throws(() => normalizeImportRows([{ player_id: 'x', ign: '' }], 'c'), /No valid rows/);
    assert.throws(() => normalizeImportRows({}, 'c'), /list of prospects/);
    assert.throws(() => normalizeImportRows(null, 'c'), /list of prospects/);
  });
  test('accepts exactly the maximum number of rows', () => {
    assert.equal(normalizeImportRows(new Array(MAX_IMPORT_ROWS).fill(good), 'c').length, MAX_IMPORT_ROWS);
  });
});

describe('roster predicates', () => {
  const now = Date.now();
  const stale = new Date(now - 5 * 86400000).toISOString();
  const fresh = new Date(now - 3600000).toISOString();
  const cutoff = now - 3 * 86400000;

  test('isFollowUp: open statuses that have gone quiet', () => {
    assert.equal(isFollowUp({ status: 'In Talks', updated_at: stale }, cutoff), true);
    assert.equal(isFollowUp({ status: 'Not Contacted', updated_at: stale }, cutoff), true);
    assert.equal(isFollowUp({ status: 'In Talks', updated_at: fresh }, cutoff), false);
    assert.equal(isFollowUp({ status: 'Committed', updated_at: stale }, cutoff), false);
    assert.equal(isFollowUp({ status: 'Rejected', updated_at: stale }, cutoff), false);
  });
  test('isUnassigned: no recruiter, still in play', () => {
    assert.equal(isUnassigned({ status: 'In Talks', recruiter: '' }), true);
    assert.equal(isUnassigned({ status: 'In Talks', recruiter: null }), true);
    assert.equal(isUnassigned({ status: 'In Talks', recruiter: 'Jett' }), false);
    assert.equal(isUnassigned({ status: 'Committed', recruiter: null }), false);
    assert.equal(isUnassigned({ status: 'Rejected', recruiter: null }), false);
  });
});

describe('dates and cycle clock', () => {
  afterEach(() => mock.timers.reset());
  const setNow = (y, m, d) => mock.timers.enable({ apis: ['Date'], now: new Date(y, m - 1, d, 12, 0, 0) });

  test('parseLocalDate reads YYYY-MM-DD in local time', () => {
    const d = parseLocalDate('2026-11-09');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 9);
    assert.equal(parseLocalDate(''), null);
    assert.equal(parseLocalDate(null), null);
  });

  test('freshCycle spans a week and uses local dates', () => {
    setNow(2026, 11, 6);
    const c = freshCycle();
    assert.equal(c.start_date, '2026-11-06');
    assert.equal(c.end_date, '2026-11-12');
    assert.equal(c.name, '');
  });
  test('isoDate is timezone safe', () => {
    assert.equal(isoDate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
    assert.equal(isoDate(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
  });

  test('rangeLabel', () => {
    assert.equal(rangeLabel('2026-11-09', '2026-11-15'), 'Nov 9, 2026 – Nov 15, 2026 · 7 days');
    assert.equal(rangeLabel('2026-11-09', '2026-11-09'), 'Nov 9, 2026 – Nov 9, 2026 · 1 day');
    assert.equal(rangeLabel('2026-11-09', null), 'Starts Nov 9, 2026 · no end date');
  });

  test('cycleCountdown: literal countdown to 00:00 UTC', () => {
    const at = (s) => Date.parse(s);
    assert.equal(cycleCountdown(null), null);
    const c = { start_date: '2026-11-09', end_date: '2026-11-15' };
    // before the start: counts down to 00:00 UTC on the start date
    assert.equal(cycleCountdown(c, at('2026-11-08T22:58:55Z')).big, '01:01:05');
    assert.equal(cycleCountdown(c, at('2026-11-06T12:00:00Z')).big, '2d 12:00:00');
    assert.equal(cycleCountdown(c, at('2026-11-06T12:00:00Z')).sub, 'Nov 9, 2026 · 00:00 UTC');
    // during: counts down to 00:00 UTC after the end date
    assert.equal(cycleCountdown(c, at('2026-11-09T00:00:00Z')).big, '7d 00:00:00');
    assert.equal(cycleCountdown(c, at('2026-11-15T23:59:59Z')).big, '00:00:01');
    assert.equal(cycleCountdown(c, at('2026-11-10T00:00:00Z')).sub, 'Nov 16, 2026 · 00:00 UTC');
    assert.deepEqual(
      ['2026-11-08T00:00:00Z', '2026-11-12T00:00:00Z', '2026-11-16T00:00:00Z'].map((t) => { const r = cycleCountdown(c, at(t)); return [r.phase, r.label]; }),
      [['upcoming', 'Starts in'], ['ongoing', 'Ends in'], ['ended', '']]);
    // after: ended
    assert.equal(cycleCountdown(c, at('2026-11-16T00:00:00Z')).big, 'Ended');
    assert.equal(cycleCountdown(c, at('2026-11-16T05:00:00Z')).sub, '05:00:00 ago');
    assert.equal(cycleCountdown({ start_date: '2026-11-01', end_date: null }, at('2026-11-06T00:00:00Z')).big, '—');
  });
  test('cycleCountdown colour warns as the deadline approaches', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    assert.equal(cycleCountdown({ start_date: '2026-11-01', end_date: '2026-11-07' }, now).tone, 'text-rose-300'); // 1.5 days
    assert.equal(cycleCountdown({ start_date: '2026-11-01', end_date: '2026-11-10' }, now).tone, 'text-amber-300'); // 4.5 days
    assert.equal(cycleCountdown({ start_date: '2026-11-01', end_date: '2026-11-20' }, now).tone, 'text-gold-400'); // 14.5 days
  });
});

describe('invite slots', () => {
  test('slotInt clamps to 0-1000 and treats junk as 0', () => {
    assert.equal(slotInt('35'), 35);
    assert.equal(slotInt(''), 0);
    assert.equal(slotInt('abc'), 0);
    assert.equal(slotInt(-4), 0);
    assert.equal(slotInt(99999), 1000);
  });
  test('presets match the game rules', () => {
    assert.deepEqual([SLOT_PRESETS.ordinary.ordinary_slots, SLOT_PRESETS.ordinary.special_slots, SLOT_PRESETS.ordinary.open_slots], [35, 3, 20]);
    assert.deepEqual([SLOT_PRESETS.leading.ordinary_slots, SLOT_PRESETS.leading.special_slots, SLOT_PRESETS.leading.open_slots], [20, 0, 10]);
  });
  test('inviteUsage counts assigned and left, ignoring rejected and untyped', () => {
    const cycle = { ordinary_slots: 2, special_slots: 1, open_slots: 0 };
    const ps = [
      { invite_type: 'Ordinary', status: 'Committed' },
      { invite_type: 'Ordinary', status: 'In Talks' },
      { invite_type: 'Ordinary', status: 'Rejected' },
      { invite_type: 'Open', status: 'In Talks' },
      { invite_type: null, status: 'In Talks' },
    ];
    const u = inviteUsage(ps, cycle);
    assert.deepEqual(u.rows.map((r) => [r.type, r.used, r.left]), [['Special', 0, 1], ['Ordinary', 2, 0], ['Open', 1, -1]]);
    assert.equal(u.total, 3);
    assert.equal(u.used, 3);
    assert.equal(u.untyped, 1);
  });
  test('inviteUsage copes with a cycle that has no totals yet', () => {
    assert.equal(inviteUsage([], undefined).total, 0);
  });
});

describe('import template', () => {
  test('has every column the importer reads, and example rows that parse', () => {
    const rows = parseCSV(templateCSV());
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), CSV_COLS);
    assert.ok(rows.every((r) => r.ign.startsWith(TEMPLATE_MARK)));
  });
  test('untouched example rows are skipped on import, real rows next to them are kept', () => {
    const raw = [...parseCSV(templateCSV()), { player_id: '290313686', ign: 'j3ttybear', status: 'Committed', invite_type: 'special', power: '153.8M' }];
    const rows = normalizeImportRows(raw, 'cycle-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ign, 'j3ttybear');
    assert.equal(rows[0].invite_type, 'Special');
    assert.throws(() => normalizeImportRows(parseCSV(templateCSV()), 'cycle-1'), /No valid rows/);
  });
  test('the example values themselves are valid import values', () => {
    const rows = parseCSV(templateCSV().split(TEMPLATE_MARK).join('Real'));
    const out = normalizeImportRows(rows, 'cycle-1');
    assert.equal(out.length, 2);
    assert.equal(out[0].power, 153800000);
    assert.equal(out[1].power, 95000000);
    assert.deepEqual(out.map((r) => r.status), ['In Talks', 'Not Contacted']);
    assert.deepEqual(out.map((r) => r.invite_type), ['Ordinary', 'Open']);
  });
});
