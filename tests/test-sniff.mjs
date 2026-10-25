// tests/test-sniff.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStreamUrl, fastResolveStream } from '../crawler.js';

test('isStreamUrl nhận .m3u8/.mpd kèm query', () => {
  assert.equal(isStreamUrl('https://pull.niues.live/live/x.m3u8?auth_key=123'), true);
  assert.equal(isStreamUrl('https://cdn/x/stream.mpd'), true);
  assert.equal(isStreamUrl('https://socoliven.tv/truc-tiep/mu-vs-arsenal/?blv=1'), false);
  assert.equal(isStreamUrl(''), false);
  assert.equal(isStreamUrl(null), false);
});

test('fastResolveStream an toàn khi URL rỗng hoặc sai cú pháp', async () => {
  assert.equal(await fastResolveStream(''), null);
  assert.equal(await fastResolveStream('not-a-url'), null);
  assert.equal(await fastResolveStream(null), null);
});
