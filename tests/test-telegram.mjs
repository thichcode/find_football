// tests/test-telegram.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, formatMatches } from '../telegram.js';

test('parseCommand tách lệnh và tham số', () => {
  assert.deepEqual(parseCommand('/find mu'), { cmd: 'find', arg: 'mu' });
  assert.deepEqual(parseCommand('/CRAWL'), { cmd: 'crawl', arg: '' });
  assert.deepEqual(parseCommand('/matches@MyBot'), { cmd: 'matches', arg: '' });
  assert.equal(parseCommand('hello'), null);
});

test('formatMatches lọc theo tên đội và gắn link', () => {
  const data = [
    { home: 'MU', away: 'Arsenal', league: 'Ngoai Hang', kickoffISO: '2026-09-06T21:00:00+07:00', links: [{ label: 'BLV LION', url: 'https://x/1' }] },
    { home: 'Real', away: 'Barca', league: 'La Liga', kickoffISO: '2026-09-06T22:30:00+07:00', links: [] },
  ];
  const out = formatMatches(data, 'mu');
  assert.match(out, /MU vs Arsenal/);
  assert.match(out, /BLV LION/);
  assert.doesNotMatch(out, /Real vs Barca/);
});

test('formatMatches báo khi không có trận', () => {
  assert.match(formatMatches([], ''), /Không có trận/);
});
