import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicVideos, youtubeChannel } from '../src/data/videos.mjs';
import { initializeMusicVideos } from '../src/scripts/music-videos.mjs';

function fixture(id = musicVideos[0].id) {
  const listeners = {};
  const frames = [];
  let focused;
  const load = {
    hidden: true,
    addEventListener: (name, fn) => (listeners.load = fn),
    focus: () => (focused = 'load'),
  };
  const close = {
    hidden: true,
    addEventListener: (name, fn) => (listeners.close = fn),
  };
  const screen = { append: (frame) => frames.push(frame) };
  const card = {
    dataset: { videoId: id, videoTitle: musicVideos[0].title },
    querySelector: (selector) =>
      ({
        '[data-video-screen]': screen,
        '[data-video-load]': load,
        '[data-video-close]': close,
      })[selector],
    ownerDocument: {
      createElement: (tag) => {
        assert.equal(tag, 'iframe');
        const frame = {
          focus: () => (focused = 'frame'),
          remove: () => frames.splice(frames.indexOf(frame), 1),
        };
        return frame;
      },
    },
  };
  return {
    root: { querySelectorAll: () => [card] },
    load,
    close,
    frames,
    listeners,
    get focused() {
      return focused;
    },
  };
}

test('the music catalog contains only the two verified official-channel videos', () => {
  assert.equal(youtubeChannel, 'https://www.youtube.com/@arisu_gyaru');
  assert.deepEqual(musicVideos, [
    { id: 'aKUpdL75XwA', title: 'Floors becomes mandatory' },
    { id: 'gsMH5iENNuM', title: 'オーリトーリ' },
  ]);
});

test('players make no request until activated and never enable autoplay', () => {
  const ui = fixture();
  initializeMusicVideos(ui.root);
  assert.equal(ui.frames.length, 0);
  assert.equal(ui.load.hidden, false);
  assert.equal(ui.close.hidden, true);
  ui.listeners.load();
  assert.equal(ui.frames.length, 1);
  assert.equal(
    ui.frames[0].src,
    'https://www.youtube-nocookie.com/embed/aKUpdL75XwA?playsinline=1',
  );
  assert.doesNotMatch(ui.frames[0].src + ui.frames[0].allow, /autoplay/);
  assert.match(ui.frames[0].title, /Floors becomes mandatory/);
  assert.equal(ui.frames[0].referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(ui.frames[0].allowFullscreen, true);
  assert.equal(ui.focused, 'frame');
  assert.equal(ui.load.hidden, true);
  assert.equal(ui.close.hidden, false);
});

test('repeated activation does not duplicate players and closing unloads and restores focus', () => {
  const ui = fixture();
  initializeMusicVideos(ui.root);
  const firstHandler = ui.listeners.load;
  initializeMusicVideos(ui.root);
  assert.equal(ui.listeners.load, firstHandler);
  ui.listeners.load();
  ui.listeners.load();
  assert.equal(ui.frames.length, 1);
  ui.listeners.close();
  assert.equal(ui.frames.length, 0);
  assert.equal(ui.load.hidden, false);
  assert.equal(ui.close.hidden, true);
  assert.equal(ui.focused, 'load');
  ui.listeners.close();
  ui.listeners.load();
  assert.equal(ui.frames.length, 1);
});

test('malformed video IDs cannot become external frame destinations', () => {
  const ui = fixture('https://example.com');
  initializeMusicVideos(ui.root);
  assert.equal(ui.load.hidden, true);
  assert.equal(ui.listeners.load, undefined);
  assert.equal(ui.frames.length, 0);
});

test('the component retains direct watch links without JS and uses no remote thumbnails', async () => {
  const component = await readFile('src/components/MusicVideos.astro', 'utf8');
  assert.match(component, /<noscript>/);
  assert.match(component, /https:\/\/www.youtube.com\/watch\?v=/);
  assert.doesNotMatch(component, /<iframe|<img|preconnect|allow=.*autoplay/);
  assert.match(component, /data-video-load\s+hidden/);
  assert.match(component, /data-video-close hidden/);
  const music = await readFile('src/pages/music.astro', 'utf8');
  assert.match(music, /<MusicVideos\s*\/>/);
  assert.match(music, /<TrackList\s*\/>/);
  assert.match(music, /ミュージックビデオは公開中/);
  const home = await readFile('src/pages/index.astro', 'utf8');
  assert.match(home, /<MusicVideos featured\s*\/>/);
});

test('CSP permits only the privacy-enhanced embed host and privacy copy explains opt-in', async () => {
  const headers = await readFile('deploy/security-headers.conf', 'utf8');
  assert.match(headers, /frame-src https:\/\/www.youtube-nocookie.com;/);
  assert.match(headers, /script-src 'self';/);
  assert.match(headers, /img-src 'self';/);
  assert.match(headers, /frame-ancestors 'none';/);
  const privacy = await readFile('src/pages/privacy.astro', 'utf8');
  assert.match(privacy, /ボタンを押した場合にのみ/);
  assert.match(privacy, /IPアドレス/);
  assert.match(privacy, /policies.google.com\/privacy/);
});
