import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMusicCover } from '../lib/music-cover.mjs';

test('cover proxy only fetches HTTPS NetEase image hosts', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return new Response('image', { headers:{'Content-Type':'image/jpeg'} }); };
  const blocked = await fetchMusicCover('https://example.com/image.jpg', { fetchImpl });
  assert.equal(blocked.status, 400);
  assert.equal(called, false);
  const allowed = await fetchMusicCover('https://p2.music.126.net/cover.jpg', { fetchImpl });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.contentType, 'image/jpeg');
  assert.equal(allowed.body.toString(), 'image');
});

test('cover proxy rejects non-image and oversized upstream responses', async () => {
  const html = await fetchMusicCover('https://p1.music.126.net/cover.jpg', {
    fetchImpl: async () => new Response('<html/>', { headers:{'Content-Type':'text/html'} }),
  });
  assert.equal(html.status, 415);

  const large = await fetchMusicCover('https://p1.music.126.net/cover.jpg', {
    maxBytes: 4,
    fetchImpl: async () => new Response('12345', { headers:{'Content-Type':'image/jpeg'} }),
  });
  assert.equal(large.status, 413);
});
