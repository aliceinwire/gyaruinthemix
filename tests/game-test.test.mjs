import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('game test stays outside navigation and public sitemap', async () => {
  assert.doesNotMatch(await read('src/data/urls.mjs'), /game-test/);
  assert.match(
    await read('src/pages/robots.txt.js'),
    /Disallow: \/game-test\//,
  );
  assert.match(
    await read('public/game-test/index.html'),
    /name="robots" content="noindex, nofollow, noarchive"/,
  );
});

test('game Docker context and scoped audio security policy are included', async () => {
  assert.match(await read('.dockerignore'), /!public\/game-test\/\*\*/);
  assert.match(
    await read('Dockerfile.web'),
    /COPY deploy\/game-security-headers.conf/,
  );
  const nginx = await read('deploy/nginx.conf');
  assert.match(nginx, /location = \/game-test \{ return 308 \/game-test\/; \}/);
  assert.match(nginx, /location \^~ \/game-test\/ \{/);
  assert.match(nginx, /X-Robots-Tag 'noindex, nofollow, noarchive'/);
  const game = await read('deploy/game-security-headers.conf');
  assert.match(game, /script-src 'self';/);
  assert.match(game, /frame-src 'none';/);
  assert.match(game, /media-src 'self' blob:;/);
  assert.doesNotMatch(game, /unsafe-inline|unsafe-eval|https:\/\/\*/);
  assert.doesNotMatch(
    await read('deploy/security-headers.conf'),
    /soundcloud|blob:|media-src/,
  );
});

test('canonical web image includes optional audio proxy and clean absent-service config', async () => {
  const dockerfile = await read('Dockerfile.web'),
    context = await read('.dockerignore'),
    locations = await read('deploy/game-audio.conf'),
    proxy = await read('deploy/game-audio-proxy.conf');
  assert.match(
    dockerfile,
    /COPY deploy\/game-audio.conf deploy\/game-audio-proxy.conf \/etc\/nginx\//,
  );
  assert.match(context, /!deploy\/game-audio.conf/);
  assert.match(context, /!deploy\/game-audio-proxy.conf/);
  assert.match(
    await read('deploy/nginx.conf'),
    /include \/etc\/nginx\/game-audio.conf;/,
  );
  assert.match(locations, /location = \/game-audio\/v1\/config/);
  assert.match(locations, /error_page 502 503 504 = @game_audio_disabled;/);
  assert.match(locations, /return 200 '\{"enabled":false\}';/);
  assert.match(locations, /location \^~ \/game-audio\//);
  assert.match(proxy, /set \$game_audio_backend http:\/\/game-audio:3001;/);
  assert.match(proxy, /proxy_pass \$game_audio_backend;/);
  assert.match(proxy, /proxy_cache off;/);
  assert.match(proxy, /private, no-store, max-age=0/);
  assert.doesNotMatch(locations + proxy, /alias |root |assets\/music/);
});

test('Nginx extends its standard MIME map for the lazy HLS JavaScript module', async () => {
  const nginx = await read('deploy/nginx.conf');
  assert.match(
    nginx,
    /http\s*\{\s*include \/etc\/nginx\/mime\.types;[\s\S]*?types\s*\{\s*application\/javascript mjs;\s*\}/,
  );
  assert.match(
    await read('public/game-test/src/stream-audio.js'),
    /import\('\.\/vendor\/hls\.light\.min\.mjs'\)/,
  );
  assert.match(
    await read('tests/browser/game-test.mjs'),
    /'\.mjs': 'application\/javascript'/,
  );
});

test('game runtime is a self-contained static snapshot without private audio', async () => {
  const manifest = JSON.parse(await read('public/game-test/build-info.json'));
  assert.match(manifest.baseSourceCommit, /^[a-f0-9]{40}$/);
  assert.match(manifest.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.sourcePublication, /Local tested snapshot/);
  async function walk(path) {
    for (const entry of await readdir(new URL(`../${path}`, import.meta.url), {
      withFileTypes: true,
    })) {
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(name);
      else assert.doesNotMatch(name, /\.(mp3|wav|ogg|m4a|key|pem|env)$/i);
    }
  }
  await walk('public/game-test');
  const html = await read('public/game-test/index.html');
  assert.match(html, /src="\.\/main.js"/);
  assert.match(html, /href="\.\/style.css"/);
  assert.doesNotMatch(html, /soundcloud|<iframe/i);
  assert.match(html, /<div id="music"/);
});
