import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createAudioHandler, loadCatalog } from './app.mjs';
const mediaRoot = process.env.AUDIO_MEDIA_ROOT || '/private/media/.hls';
const enabled = process.env.GAME_AUDIO_ENABLED === 'true';
const tracks = enabled ? await loadCatalog(mediaRoot) : new Map();
const key = enabled
  ? await readFile(
      process.env.AUDIO_SIGNING_KEY_FILE ||
        '/run/secrets/game_audio_signing_key',
    )
  : null;
const handler = createAudioHandler({
  tracks,
  key,
  origin: process.env.AUDIO_ORIGIN,
  enabled,
});
const server = createServer(async (req, res) => {
  if (!(await handler(req, res))) {
    res.writeHead(404);
    res.end();
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 40;
server.listen(3001, '0.0.0.0', () =>
  console.log(JSON.stringify({ event: 'audio_ready', tracks: tracks.size })),
);
let refreshing = false,
  lastModified = enabled
    ? (await stat(`${mediaRoot}/catalog.json`)).mtimeMs
    : 0;
const refresh = setInterval(async () => {
  if (!enabled || refreshing) return;
  refreshing = true;
  try {
    const modified = (await stat(`${mediaRoot}/catalog.json`)).mtimeMs;
    if (modified !== lastModified) {
      handler.replaceTracks(await loadCatalog(mediaRoot));
      lastModified = modified;
    }
  } catch {
    console.warn(JSON.stringify({ event: 'audio_catalog_refresh_failed' }));
  } finally {
    refreshing = false;
  }
}, 30000);
refresh.unref();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
