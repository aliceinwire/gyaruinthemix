import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createState, exportNightfallSave } from '../../public/game/src/simulation.js';
import { NIGHTFALL_SAVE_KEY } from '../../public/game/src/save-store.js';
import { CHROME_BOUNCE_CHART as chart, TRACK_CHARTS } from '../../public/game/src/track-charts.js';
import { checkMusicDrive } from './music-drive.mjs';
import { LANGUAGES } from '../../public/game/src/i18n.js';

function audioFixture(duration) {
  const samples = Math.ceil(duration * 8000), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 90 / 8000) * 5000), 44 + i * 2);
  const frames = Math.ceil(duration * 20), spectrum = Buffer.alloc(8 + frames * 5, 140);
  spectrum.write('GEQ1'); spectrum.writeUInt32LE(frames, 4);
  return { wav, spectrum };
}

export async function checkClubChart(browser, { root, csp }) {
  const origin = 'http://club-chart.local';
  const state = createState({ mode: 'survival', survivalDay: '2026-10-23', routeIndex: 3, campaignStarted: true });
  state.status = 'won'; state.distance = state.routeLength; state.stagesCompleted = 4;
  state.survival.quizRoads = [3];
  const saved = exportNightfallSave(state);
  const nextTrack = 't-' + 'a'.repeat(24), sessionId = 's'.repeat(32);
  const catalog = [
    { id: chart.trackId, title: chart.title, duration: chart.duration, excerpt: false },
    { id: nextTrack, title: 'Another song', duration: chart.duration, excerpt: false },
    ...TRACK_CHARTS.slice(1).map(track => ({ id: track.trackId, title: track.title, duration: track.duration, excerpt: false })),
  ];
  const fixtures = new Map(catalog.map(track => [track.id, audioFixture(track.duration)]));
  const context = await browser.newContext({ viewport: { width: 390, height: 667 }, hasTouch: true, locale: 'en-US', reducedMotion: 'no-preference' });
  const errors = [];
  try {
    await context.addInitScript(({ saved, key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
      const canPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function(type) { return type === 'application/vnd.apple.mpegurl' ? 'probably' : canPlayType.call(this, type); };
      AudioContext.prototype.createMediaElementSource = () => { throw new Error('Native HLS must not need an analyser'); };
    }, { saved, key: NIGHTFALL_SAVE_KEY });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/game-audio/v1/config') return route.fulfill({ json: { enabled: true } });
      if (url.pathname === '/game-audio/v1/catalog') return route.fulfill({ json: { tracks: catalog } });
      if (url.pathname === '/game-audio/v1/session') {
        const { trackId } = route.request().postDataJSON();
        return route.fulfill({ json: { trackId, sessionId, expiresAt: Date.now() + 120000, renewAfterMs: 40000,
          manifestUrl: `/fixture/${trackId}.wav`, spectrumUrl: `/game-audio/v1/stream/${trackId}/${sessionId}/spectrum.bin` } });
      }
      if (url.pathname.endsWith('/spectrum.bin')) return route.fulfill({ contentType: 'application/octet-stream', body: fixtures.get(url.pathname.split('/')[4]).spectrum });
      if (url.pathname.startsWith('/fixture/') && url.pathname.endsWith('.wav')) {
        const { wav } = fixtures.get(url.pathname.slice('/fixture/'.length, -4));
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
          headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
      }
      const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
      try {
        return route.fulfill({ body: await readFile(resolve(root, 'dist', path.slice(1))),
          contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' })[extname(path)] || 'application/octet-stream',
          headers: { 'content-security-policy': csp } });
      } catch { errors.push(path); return route.fulfill({ status: 404 }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/game/?lang=en');
    await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
    assert.equal(await page.locator('#streaming-guidelines').getAttribute('href'), '/en/streaming-guidelines/');
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    await page.locator('audio').evaluate(media => { media.currentTime = 53; });
    await page.locator('#resume-tour').click();
    for (let i = 0; i < 20; i++) {
      if (await page.locator('#story-next').isVisible()) await page.locator('#story-next').click();
      else if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen === 'finale')) break;
      else await page.waitForTimeout(50);
    }
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen === 'finale');
    assert.equal(await page.locator('#performance-track').isVisible(), true);
    assert.match(await page.locator('#performance-tip').textContent(), /once.*line|line.*once/);
    assert.match(await page.locator('#finale-home').textContent(), /Skip/);
    assert.match(await page.locator('#rhythm-status').textContent(), /Optional/);
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    async function checkLayout(stageName) {
      for (const [width, height] of [[390, 667], [320, 568], [414, 768], [844, 390]]) {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/rhythm-${stageName}-${width}.png`) });
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${stageName} fits ${width}`);
        for (const selector of ['#finale-home', '[data-control="boost"]', '[data-control="charge"]', '[data-control="rush"]']) {
          const b = await page.locator(selector).boundingBox();
          assert.ok(b && b.x >= 0 && b.x + b.width <= width + 1 && b.y >= 0 && b.y + b.height <= height + 1 && b.height >= 44, `${stageName} ${selector} is reachable on ${width}`);
          assert.ok(await page.locator(selector).evaluate(el => {
            const b = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
          }), `${stageName} ${selector} is not covered on ${width}`);
        }
        const stage = await page.locator('.viewport').boundingBox();
        assert.ok(stage.height >= 80, `${stageName} stage remains visible on ${width}: ${stage.height}`);
      }
      await page.setViewportSize({ width: 390, height: 667 });
    }
    await checkLayout('ready');
    await page.setViewportSize({ width: 320, height: 568 });
    for (const { code } of LANGUAGES) {
      await page.locator('.masthead select').selectOption(code);
      await page.waitForFunction(code => document.documentElement.lang === code, code);
      await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/rhythm-ready-${code}.png`) });
      for (const selector of ['#performance-track', '#finale-home', '[data-control="charge"]']) {
        assert.ok(await page.locator(selector).evaluate(el => {
          const b = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(b.x + b.width / 2, b.bottom - 3));
        }), `${code} instructions leave ${selector} uncovered`);
      }
    }
    await page.locator('.masthead select').selectOption('en');
    await page.setViewportSize({ width: 390, height: 667 });
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.elapsed), 0, 'instructions wait for an explicit start');
    await page.locator('#performance-track').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.playing);
    assert.equal(await page.locator('#rhythm-board').isVisible(), true);
    assert.match(await page.locator('[data-control="charge"]').textContent(), /Bass/);
    assert.match(await page.locator('[data-control="rush"]').textContent(), /Drop/);
    assert.ok(await page.locator('audio').evaluate(media => media.currentTime >= 53), 'club entry keeps the current song position');
    assert.equal(await page.locator('#performance-track').isVisible(), false);
    const baseline = await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot().state));
    assert.equal(await page.locator('audio').count(), 1);
    for (const [seconds, index] of [[53, 3], [78, 4], [91, 5], [104, 6], [117, 7], [127, 8], [142, 9]]) {
      const before = await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.elapsed);
      await page.locator('audio').evaluate((media, seconds) => { media.currentTime = seconds; }, seconds);
      await page.waitForFunction(index => __HYPERDRIVE__.snapshot().performanceSet.phraseIndex === index, index);
      assert.ok(await page.evaluate(before => __HYPERDRIVE__.snapshot().performanceSet.elapsed < before + 1, before), 'seeking cannot skip the encore');
    }
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 0);
    // Use real keyboard events during the visible hit window, then hold through later notes.
    const note = await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.notes.find(note => note.status === 'pending'));
    await page.waitForFunction(id => {
      const set = __HYPERDRIVE__.snapshot().performanceSet;
      const n = set.notes.find(note => note.id === id);
      return n && n.at - set.elapsed < .1;
    }, note.id, { polling: 'raf' });
    const key = { boost: 'Space', charge: 'KeyE', rush: 'KeyX' }[note.action];
    await page.keyboard.down(key);
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.hits === 1);
    await page.keyboard.down(key);
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 1, 'holding and key repeat do not score later notes');
    await page.keyboard.up(key);
    await checkLayout('playing');
    const touchNote = await page.evaluate(() => {
      const set = __HYPERDRIVE__.snapshot().performanceSet;
      return set.notes.find(note => note.status === 'pending' && note.at > set.elapsed + .3);
    });
    const pad = await page.locator(`[data-control="${touchNote.action}"]`).boundingBox();
    await page.waitForFunction(id => {
      const set = __HYPERDRIVE__.snapshot().performanceSet;
      return set.notes.some(note => note.id === id && note.at - set.elapsed < .1);
    }, touchNote.id, { polling: 'raf' });
    await page.touchscreen.tap(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.hits === 2);
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => !__HYPERDRIVE__.snapshot().performanceSet.playing);
    assert.equal(await page.locator('[data-control].suggested').count(), 0);
    const pausedAt = await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.elapsed);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.elapsed), pausedAt);
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.playing);
    await page.locator('#pause').click();
    await page.locator('audio').evaluate(media => { media.currentTime = 54; });
    await page.locator('#resume').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.phraseIndex === 3);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 2);
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(id => {
      const set = __HYPERDRIVE__.snapshot().performanceSet;
      return set.trackId === id && set.playing && !set.chart;
    }, nextTrack);
    await page.locator('audio').evaluate(media => { media.currentTime = 57; });
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.interrupted), false);
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.musicTime >= 57);
    assert.equal(await page.locator('#performance-phase').textContent(), 'FREE RHYTHM');
    await page.locator('audio').evaluate(media => { media.currentTime = media.duration - .15; });
    await page.waitForFunction(id => {
      const set = __HYPERDRIVE__.snapshot().performanceSet;
      return set.trackId !== id && set.playing;
    }, nextTrack);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.done), false, 'the song ending must not cut off a late-started set');
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.done, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot().state)), baseline);
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    await checkLayout('done');
    const beforeEncore = await page.locator('audio').evaluate(media => media.currentTime);
    await page.locator('#performance-track').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.playing);
    assert.ok(await page.locator('audio').evaluate((media, before) => media.currentTime >= before && media.currentTime < before + 2, beforeEncore), 'encore does not restart the radio');
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 0);
    for (const selected of TRACK_CHARTS) {
      await page.setViewportSize({ width: 390, height: 667 });
      await page.locator('[data-action="list"]').click();
      await page.locator('.stereo-playlist select').selectOption(selected.trackId);
      await page.locator('[data-action="list"]').click();
      await page.waitForFunction(id => {
        const set = __HYPERDRIVE__.snapshot().performanceSet;
        return set.playing && set.chart?.trackId === id;
      }, selected.trackId);
      const drop = selected.sections.findIndex(section => section.kind === 'drop');
      await page.locator('audio').evaluate((media, seconds) => { media.currentTime = seconds; }, selected.sections[drop].start + .2);
      await page.waitForFunction(index => __HYPERDRIVE__.snapshot().performanceSet.phraseIndex === index, drop);
      assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 0);
      assert.equal(await page.locator('audio').count(), 1);
      assert.equal(await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot().state)), baseline);
    }
    const radioBeforeSkip = await page.locator('audio').evaluate(media => media.currentTime);
    await page.locator('#finale-home').click();
    for (let i = 0; i < 30; i++) {
      if (await page.locator('#story-next').isVisible()) await page.locator('#story-next').click();
      else if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen === 'map')) break;
      else await page.waitForTimeout(40);
    }
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().screen === 'map');
    assert.ok(await page.locator('audio').evaluate((media, before) => media.currentTime >= before, radioBeforeSkip), 'skipping keeps radio playback');
    assert.equal(await page.locator('audio').count(), 1);
    assert.match(await page.locator('[data-control="boost"]').textContent(), /Fly/);
    await checkMusicDrive(page, root);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log('PASS optional tap-based club set, mobile controls, immediate skip, radio continuity and replay');
}
