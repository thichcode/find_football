import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeam, matchKey, dedupeMatches, groupMatches } from '../lib/normalize.js';
test('normalizeTeam lowercases and trims', () => { assert.equal(normalizeTeam('  MU  '), 'mu'); });
test('normalizeTeam strips punctuation so slug names match', () => {
  assert.equal(normalizeTeam('1. FSV Mainz 05'), normalizeTeam('1-fsv-mainz-05'));
});
test('matchKey groups same fixture same hour', () => {
  const a = { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-06T21:00:00+07:00' };
  const b = { home: 'mu', away: ' arsenal ', kickoffISO: '2026-09-06T21:05:00+07:00' };
  assert.equal(matchKey(a), matchKey(b));
});
test('dedupeMatches merges links', () => {
  const input = [
    { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-06T21:00:00+07:00', league: 'Ngoai Hang', links: [{ label: 'Gavang', url: 'https://x/1' }] },
    { home: 'mu', away: 'arsenal', kickoffISO: '2026-09-06T21:00:00+07:00', league: 'Ngoai Hang', links: [{ label: 'Socolive', url: 'https://x/2' }] }
  ];
  const out = dedupeMatches(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].links.length, 2);
});
test('groupMatches gộp cùng cặp đấu khác giờ thành 1 dòng, giữ giờ thật', () => {
  const input = [
    { home: 'everton', away: 'manchester united', kickoffISO: '2026-09-06T00:00:00+07:00', league: 'Tong hop', links: [{ label: 'GavangTV', url: 'https://g/1' }] },
    { home: 'Everton', away: 'Manchester United', kickoffISO: '2026-09-06T20:00:00+07:00', league: 'Ngoai Hang', links: [{ label: 'BLV LION', url: 'https://s/1' }] }
  ];
  const out = groupMatches(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].kickoffISO, '2026-09-06T20:00:00+07:00');
  assert.equal(out[0].links.length, 2);
});
test('groupMatches không gộp khác ngày', () => {
  const input = [
    { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-06T21:00:00+07:00', links: [] },
    { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-13T21:00:00+07:00', links: [] }
  ];
  assert.equal(groupMatches(input).length, 2);
});
