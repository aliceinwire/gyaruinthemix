import assert from 'node:assert/strict';
import {
  AUDIO_FIXTURE_KEY,
  AUDIO_FIXTURE_SOURCE,
  AUDIO_FIXTURE_TITLE,
} from './ci-game-audio-fixtures.mjs';

export async function assertPrivateAudioDenied(response, path) {
  assert.ok(
    [403, 404].includes(response.status),
    `${path}: private content must be denied, got ${response.status}`,
  );
  assert.doesNotMatch(
    response.headers.get('content-type') || '',
    /^(?:audio|video)\/|application\/(?:octet-stream|vnd\.apple\.mpegurl)/i,
    `${path}: denial must not contain media`,
  );
  const body = await response.text();
  assert.ok(!body.includes(AUDIO_FIXTURE_KEY), `${path}: fixture key exposed`);
  assert.doesNotMatch(
    body,
    /"(?:tracks|chunks|sourceHash)"\s*:|#EXTM3U|#EXT-X-|\b(?:ftyp|moof)\b/,
    `${path}: denial must not expose a catalog or media payload`,
  );
}

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
    `/game/assets/music/${AUDIO_FIXTURE_SOURCE}`,
    '/assets/music/.hls/catalog.json',
    '/game/assets/music/.hls/catalog.json',
  ]) {
    const response = await fetch(new URL(path, base), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    await assertPrivateAudioDenied(response, path);
    if (path.startsWith('/game/')) {
      const legacy = await fetch(
        new URL(path.replace('/game/', '/game-test/'), base),
        {
          signal: AbortSignal.timeout(15000),
        },
      );
      await assertPrivateAudioDenied(legacy, path);
    }
  }
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
  assert.doesNotMatch(metadata, /sourceHash|chunks|path|\.wav/);
  assert.ok(!metadata.includes(AUDIO_FIXTURE_KEY));
  const { tracks } = JSON.parse(metadata);
  assert.equal(tracks.length, 1, 'Only the synthetic CI track is permitted');
  assert.match(tracks[0].id, /^t-[a-f0-9]{24}$/);
  assert.equal(tracks[0].title, AUDIO_FIXTURE_TITLE);
  assert.equal(tracks[0].artist, undefined);
  assert.deepEqual(Object.keys(tracks[0]).sort(), [
    'duration',
    'excerpt',
    'id',
    'title',
  ]);
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
  const { manifestUrl, spectrumUrl } = await session.json();
  assert.ok(manifestUrl.startsWith('/game-audio/v1/stream/'));
  assert.ok(
    spectrumUrl.startsWith('/game-audio/v1/stream/') &&
      spectrumUrl.endsWith('/spectrum.bin'),
  );
  await request(spectrumUrl, 401);
  const envelope = await request(spectrumUrl, 200, { headers });
  assert.equal(
    envelope.headers.get('content-type'),
    'application/octet-stream',
  );
  assert.match(envelope.headers.get('cache-control'), /no-store/);
  const levels = Buffer.from(await envelope.arrayBuffer());
  assert.ok(levels.length >= 13 && levels.length <= 1024 * 1024);
  assert.equal(levels.toString('ascii', 0, 4), 'GEQ1');
  assert.equal(levels.length, 8 + levels.readUInt32LE(4) * 5);
  assert.ok(levels.subarray(8).some((value) => value > 0));
  await request(spectrumUrl, 403, {
    headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' },
  });
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
