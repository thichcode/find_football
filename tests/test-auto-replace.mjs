// tests/test-auto-replace.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { replaceMatchDomains, updateSourceScheduleUrl } from '../crawler.js';

test('replaceMatchDomains thay the domain Socolive cu thanh domain moi', () => {
  const matches = [
    {
      home: 'Chelsea',
      away: 'Arsenal',
      links: [
        { label: 'Link 1', url: 'https://socolivenp.top/truc-tiep/chelsea-vs-arsenal-07-11-2026/' },
        { label: 'BLV 1', url: 'https://socolive23.co/truc-tiep/chelsea-vs-arsenal-07-11-2026/?blv=118206' },
        { label: 'Khác', url: 'https://other-site.com/live/1' },
      ],
    },
  ];

  const updated = replaceMatchDomains(matches, 'https://socolive9.icu');

  assert.equal(updated[0].links[0].url, 'https://socolive9.icu/truc-tiep/chelsea-vs-arsenal-07-11-2026/');
  assert.equal(updated[0].links[1].url, 'https://socolive9.icu/truc-tiep/chelsea-vs-arsenal-07-11-2026/?blv=118206');
  // Domain khac khong bi thay doi
  assert.equal(updated[0].links[2].url, 'https://other-site.com/live/1');
});

test('replaceMatchDomains loai bo link trung sau khi doi domain', () => {
  const matches = [
    {
      home: 'MU',
      away: 'Liverpool',
      links: [
        { label: 'Link 1', url: 'https://socolivenp.top/truc-tiep/mu-vs-liverpool/' },
        { label: 'Link cũ', url: 'https://socolive9.icu/truc-tiep/mu-vs-liverpool/' },
      ],
    },
  ];

  const updated = replaceMatchDomains(matches, 'https://socolive9.icu');
  assert.equal(updated[0].links.length, 1);
  assert.equal(updated[0].links[0].url, 'https://socolive9.icu/truc-tiep/mu-vs-liverpool/');
});

test('updateSourceScheduleUrl cap nhat file sources.js mau', () => {
  const tmpFile = path.join(os.tmpdir(), `test-sources-${Date.now()}.js`);
  const initial = `export const SOURCES = [
  {
    id: 'socolive',
    scheduleUrl: 'https://old-domain.com/',
  },
];`;
  fs.writeFileSync(tmpFile, initial, 'utf8');

  updateSourceScheduleUrl(tmpFile, 'socolive', 'https://new-domain.com/');
  const content = fs.readFileSync(tmpFile, 'utf8');
  assert.ok(content.includes("scheduleUrl: 'https://new-domain.com/'"));
  fs.unlinkSync(tmpFile);
});
