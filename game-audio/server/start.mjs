import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createAudioHandler, loadCatalog } from './app.mjs';
const mediaRoot = process.env.AUDIO_MEDIA_ROOT || '/private/media/.hls';
const tracks = await loadCatalog(mediaRoot);
const key = await readFile(
  process.env.AUDIO_SIGNING_KEY_FILE || '/run/secrets/game_audio_signing_key',
);
const handler = createAudioHandler({
  tracks,
  key,
  origin: process.env.AUDIO_ORIGIN,
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
  lastModified = (await stat(`${mediaRoot}/catalog.json`)).mtimeMs;
const refresh = setInterval(async () => {
  if (refreshing) return;
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
