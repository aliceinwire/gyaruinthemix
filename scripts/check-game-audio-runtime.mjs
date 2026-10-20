import assert from 'node:assert/strict';
import {
  AUDIO_FIXTURE_KEY,
  AUDIO_FIXTURE_SOURCE,
} from './ci-game-audio-fixtures.mjs';

export async function checkGameAudioRuntime(
  base,
  { enabled, origin = 'https://gyaruinthemix.example' },
) {
  const request = async (path, status, options = {}) => {
    const response = await fetch(new URL(path, base), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      ...options,
    });
    assert.equal(response.status, status, `${path.split('?')[0]} status`);
    return response;
  };
  const config = await request('/game-audio/v1/config', 200);
  assert.deepEqual(await config.json(), { enabled });
  assert.match(config.headers.get('cache-control'), /no-store/);
  for (const path of [
    `/assets/music/${AUDIO_FIXTURE_SOURCE}`,
    `/game-test/assets/music/${AUDIO_FIXTURE_SOURCE}`,
    '/assets/music/.hls/catalog.json',
    '/game-test/assets/music/.hls/catalog.json',
  ])
    await request(path, 404);
  if (!enabled) {
    const catalog = await fetch(new URL('/game-audio/v1/catalog', base), {
      signal: AbortSignal.timeout(15000),
    });
    assert.ok([404, 502, 503, 504].includes(catalog.status));
    console.log('PASS default-off audio config and private library isolation');
    return;
  }
  const catalog = await request('/game-audio/v1/catalog', 200);
  const metadata = await catalog.text();
  assert.doesNotMatch(metadata, /sourceHash|chunks|path|ci-synthetic|\.wav/);
  assert.ok(!metadata.includes(AUDIO_FIXTURE_KEY));
  const { tracks } = JSON.parse(metadata);
  assert.equal(tracks.length, 1, 'Only the synthetic CI track is permitted');
  assert.match(tracks[0].id, /^t-[a-f0-9]{24}$/);
  assert.ok(tracks[0].duration > 0 && tracks[0].duration < 10);
  const options = {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId: tracks[0].id }),
  };
  await request('/game-audio/v1/session', 403, {
    ...options,
    headers: { ...options.headers, Origin: 'https://other.example' },
  });
  const session = await request('/game-audio/v1/session', 200, options);
  const setCookie = session.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Secure/);
  const headers = { Cookie: setCookie.split(';')[0] };
  const { manifestUrl } = await session.json();
  assert.ok(manifestUrl.startsWith('/game-audio/v1/stream/'));
  await request(manifestUrl, 401);
  await request(manifestUrl.split('?')[0], 401, { headers });
  const manifest = await request(manifestUrl, 200, { headers });
  assert.match(manifest.headers.get('cache-control'), /no-store/);
  const playlist = await manifest.text();
  assert.match(playlist, /#EXT-X-ENDLIST/);
  const initialization = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  const segment = playlist.split('\n').find((line) => line.endsWith('.m4s'));
  assert.ok(initialization && segment);
  for (const path of [initialization, segment]) {
    await request(path, 401);
    const media = await request(path, 200, { headers });
    const bytes = await media.arrayBuffer();
    assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 256 * 1024);
    assert.match(media.headers.get('cache-control'), /no-store/);
  }
  const range = await request(segment, 206, {
    headers: { ...headers, Range: 'bytes=0-9' },
  });
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.match(range.headers.get('content-range'), /^bytes 0-9\/\d+$/);
  await request(segment, 403, {
    headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
  });
  // A small, bounded concurrent stream burst, never a benchmark or load test.
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      const response = await request(segment, 200, { headers });
      assert.ok((await response.arrayBuffer()).byteLength <= 256 * 1024);
    }),
  );
  console.log(
    'PASS synthetic audio: same-origin config, private metadata, signed HLS, range access and bounded stream burst',
  );
}
