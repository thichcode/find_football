// tests/test-filter.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMatches } from '../lib/normalize.js';

const DATA = [
  { home: 'MU', away: 'Arsenal', league: 'Ngoai Hang', kickoffISO: '2026-09-06T21:00:00+07:00', isLive: true, links: [] },
  { home: 'Real', away: 'Barca', league: 'La Liga', kickoffISO: '2026-09-06T22:30:00+07:00', isLive: false, links: [] },
  { home: 'Viet Nam', away: 'Thai Lan', league: 'AFF Cup', kickoffISO: '2026-09-06T19:30:00+07:00', isLive: false, links: [] }
];

test('search by team name', () => {
  const out = filterMatches(DATA, { q: 'mu', onlyLive: false, league: 'all' });
  assert.equal(out.length, 1);
  assert.equal(out[0].home, 'MU');
});

test('onlyLive filter', () => {
  const out = filterMatches(DATA, { q: '', onlyLive: true, league: 'all' });
  assert.equal(out.length, 1);
  assert.equal(out[0].isLive, true);
});

test('league filter', () => {
  const out = filterMatches(DATA, { q: '', onlyLive: false, league: 'La Liga' });
  assert.equal(out.length, 1);
  assert.equal(out[0].home, 'Real');
});
