// tests/test-firecrawl.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlvAria, pickBlvName, buildBlvGroups } from '../lib/normalize.js';
import { parseBlvCardsFromHtml, parseJsonLdFromHtml, parseGoogleHosts, scrapeHtml } from '../lib/firecrawl.js';

const SRC = { id: 'socolive', name: 'Socolive' };

test('parseBlvAria tách đội + giờ + ngày', () => {
  const p = parseBlvAria('BLV Link Trực Tiếp MU vs Arsenal vào lúc 21:00 16/09/2026');
  assert.deepEqual(p, { home: 'MU', away: 'Arsenal', iso: '2026-09-16T21:00:00+07:00' });
  assert.equal(parseBlvAria('xem highlight hôm nay'), null);
});

test('pickBlvName lọc chữ trang trí, giữ tên thật', () => {
  assert.equal(pickBlvName(['BLV đông nhưng chất', 'HẢI THANH']), 'HẢI THANH');
  assert.equal(pickBlvName(['Trực tiếp bóng đá', 'BLV TẠ BIÊN GIỚI']), 'TẠ BIÊN GIỚI');
  assert.equal(pickBlvName(['xem ngay']), '');
});

const FIXTURE = `
<a class="dropdown-item" href="https://socoliven.tv/truc-tiep/mu-vs-arsenal-16-09-2026/?blv=1"
   aria-label="BLV Link Trực Tiếp MU vs Arsenal vào lúc 21:00 16/09/2026">
  <span>BLV đông nhưng chất</span><span>HẢI THANH</span>
</a>
<a class="dropdown-item" href="https://socoliven.tv/truc-tiep/mu-vs-arsenal-16-09-2026/?blv=2"
   aria-label="BLV Link Trực Tiếp MU vs Arsenal vào lúc 21:00 16/09/2026">
  <img alt="TẠ BIÊN GIỚI">
</a>
<a href="/tin-tuc/bong-da">tin bóng đá</a>`;

test('parseBlvCardsFromHtml gom 2 link BLV thành 1 trận', () => {
  const rows = parseBlvCardsFromHtml(FIXTURE, 'https://socoliven.tv/', SRC);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].home, 'MU');
  assert.equal(rows[0].links.length, 2);
  assert.match(rows[0].links[0].label, /HẢI THANH/);
  assert.match(rows[0].links[1].label, /TẠ BIÊN GIỚI/);
});

test('parseJsonLdFromHtml đọc BroadcastEvent', () => {
  const html = `<script type="application/ld+json">{"@type":"BroadcastEvent","name":"x",
    "startDate":"2026-09-16T21:00:00+07:00",
    "performer":[{"name":"MU"},{"name":"Arsenal"}]}</script>`;
  const rows = parseJsonLdFromHtml(html, 'https://socoliven.tv/', SRC);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].away, 'Arsenal');
});

test('buildBlvGroups bỏ aria không khớp', () => {
  const rows = buildBlvGroups([{ label: 'không phải aria', texts: [], imgs: [], url: 'https://x/1' }], 's', 'S');
  assert.deepEqual(rows, []);
});

test('scrapeHtml trả null khi chưa có key', async () => {
  const old = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  assert.equal(await scrapeHtml('https://example.com/'), null);
  if (old !== undefined) process.env.FIRECRAWL_API_KEY = old;
});

test('parseGoogleHosts giữ đúng thứ tự, lọc youtube/facebook', () => {
  const html = `
    <a href="/url?q=https://socoliven.tv/truc-tiep&amp;sa=U">Socolive</a>
    <a href="/url?q=https://www.youtube.com/watch%3Fv%3Dabc&amp;sa=U">YT</a>
    <a href="/url?q=https://socolivexyz.blog/lich&amp;sa=U">blog</a>
    <cite>https://socoliven.tv › truc-tiep</cite>`;
  assert.deepEqual(parseGoogleHosts(html, 'socolive'), ['socoliven.tv', 'socolivexyz.blog']);
  assert.deepEqual(parseGoogleHosts(html, 'xoilac'), []);
});
