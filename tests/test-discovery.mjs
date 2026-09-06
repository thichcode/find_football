// tests/test-discovery.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidateHosts, hostFromBingResult } from '../crawler.js';

test('giữ domain chứa từ khóa, loại big-tech và trùng lặp', () => {
  const hosts = [
    'socoliveo.tv', 'www.socolivexv.com', 'socoliveo.tv',
    'google.com', 'www.youtube.com', 'facebook.com',
    'randomsite.net', 'not a host!!'
  ];
  assert.deepEqual(filterCandidateHosts(hosts, 'socolive'), ['socoliveo.tv', 'socolivexv.com']);
});

test('giới hạn tối đa 8 ứng viên', () => {
  const hosts = Array.from({ length: 20 }, (_, i) => `socolive${i}.tv`);
  assert.equal(filterCandidateHosts(hosts, 'socolive').length, 8);
});

test('keyword khác nhau cho từng nguồn', () => {
  assert.deepEqual(filterCandidateHosts(['gavangtv.tv', 'socoliveo.tv'], 'gavang'), ['gavangtv.tv']);
});

test('hostFromBingResult đọc domain từ cite', () => {
  assert.equal(hostFromBingResult('https://www.bing.com/ck/a?u=xyz', 'https://www.socolive18.net'), 'socolive18.net');
  assert.equal(hostFromBingResult('https://www.bing.com/ck/a?u=xyz', 'https://m.socolivepp.co › match.html'), 'm.socolivepp.co');
});

test('hostFromBingResult giải mã tham số u= khi không có cite', () => {
  const real = 'https://socolive2.cv/';
  const b64 = 'a1' + Buffer.from(real).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(hostFromBingResult(`https://www.bing.com/ck/a?u=${encodeURIComponent(b64)}`, ''), 'socolive2.cv');
});
