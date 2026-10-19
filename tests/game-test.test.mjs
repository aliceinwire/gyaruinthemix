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

test('game Docker context and scoped SoundCloud security policy are included', async () => {
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
  assert.match(game, /script-src 'self' https:\/\/w.soundcloud.com;/);
  assert.match(game, /frame-src https:\/\/w.soundcloud.com;/);
  assert.doesNotMatch(game, /unsafe-inline|unsafe-eval|https:\/\/\*/);
  assert.doesNotMatch(await read('deploy/security-headers.conf'), /soundcloud/);
});

test('game runtime is a self-contained static snapshot without private audio', async () => {
  const manifest = JSON.parse(await read('public/game-test/build-info.json'));
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
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
  assert.match(html, /https:\/\/w.soundcloud.com\/player\//);
});
