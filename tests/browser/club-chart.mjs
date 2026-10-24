import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createState, exportNightfallSave } from '../../public/game-test/src/simulation.js';
import { NIGHTFALL_SAVE_KEY } from '../../public/game-test/src/save-store.js';
import { CHROME_BOUNCE_CHART as chart } from '../../public/game-test/src/track-charts.js';

export async function checkClubChart(browser, { root, csp }) {
  const origin = 'http://club-chart.local';
  const state = createState({ mode: 'survival', survivalDay: '2026-10-23', routeIndex: 3, campaignStarted: true });
  state.status = 'won'; state.distance = state.routeLength; state.stagesCompleted = 4;
  state.survival.quizRoads = [3];
  const saved = exportNightfallSave(state);
  const samples = Math.ceil(chart.duration * 8000), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 90 / 8000) * 5000), 44 + i * 2);
  const frames = Math.ceil(chart.duration * 20), spectrum = Buffer.alloc(8 + frames * 5, 140);
  spectrum.write('GEQ1'); spectrum.writeUInt32LE(frames, 4);
  const nextTrack = 't-' + 'a'.repeat(24), sessionId = 's'.repeat(32);
  const context = await browser.newContext({ viewport: { width: 390, height: 667 }, locale: 'en-US', reducedMotion: 'no-preference' });
  const errors = [];
  try {
    await context.addInitScript(({ saved, key }) => {
      localStorage.setItem(key, JSON.stringify(saved));
      const canPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function(type) { return type === 'application/vnd.apple.mpegurl' ? 'probably' : canPlayType.call(this, type); };
      AudioContext.prototype.createMediaElementSource = () => { throw new Error('Native HLS must not need an analyser'); };
    }, { saved, key: NIGHTFALL_SAVE_KEY });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/game-audio/v1/config') return route.fulfill({ json: { enabled: true } });
      if (url.pathname === '/game-audio/v1/catalog') return route.fulfill({ json: { tracks: [
        { id: chart.trackId, title: chart.title, duration: chart.duration, excerpt: false },
        { id: nextTrack, title: 'Another song', duration: chart.duration, excerpt: false },
      ] } });
      if (url.pathname === '/game-audio/v1/session') {
        const { trackId } = route.request().postDataJSON();
        return route.fulfill({ json: { trackId, sessionId, expiresAt: Date.now() + 120000, renewAfterMs: 40000,
          manifestUrl: '/fixture.wav', spectrumUrl: `/game-audio/v1/stream/${trackId}/${sessionId}/spectrum.bin` } });
      }
      if (url.pathname.endsWith('/spectrum.bin')) return route.fulfill({ contentType: 'application/octet-stream', body: spectrum });
      if (url.pathname === '/fixture.wav') {
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
    await page.goto(origin + '/game-test/?lang=en');
    await page.waitForFunction(() => globalThis.__HYPERDRIVE__?.snapshot().ready);
    await page.locator('#resume-tour').click();
    for (let i = 0; i < 20; i++) {
      if (await page.locator('#story-next').isVisible()) await page.locator('#story-next').click();
      else if (await page.evaluate(() => __HYPERDRIVE__.snapshot().screen === 'finale')) break;
      else await page.waitForTimeout(50);
    }
    await page.locator('#performance-track').waitFor({ state: 'visible' });
    assert.equal(await page.locator('audio').evaluate(media => media.paused), true, 'arriving does not switch on music');
    const baseline = await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot().state));
    await page.locator('#performance-track').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.playing);
    assert.equal(await page.locator('audio').count(), 1);
    for (const [seconds, index] of [[53, 3], [78, 4], [91, 5], [104, 6], [117, 7], [127, 8], [142, 9]]) {
      await page.locator('audio').evaluate((media, seconds) => { media.currentTime = seconds; }, seconds);
      await page.waitForFunction(index => __HYPERDRIVE__.snapshot().performanceSet.phraseIndex === index, index);
    }
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 0);
    await page.keyboard.down('KeyX');
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.hits === 1);
    await page.keyboard.up('KeyX');
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    await page.screenshot({ path: resolve(root, 'artifacts/browser/game-test/charted-club-active.png') });
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
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 1);
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.interrupted);
    await page.locator('#performance-track').click();
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.playing);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.hits), 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('audio').evaluate(media => { media.currentTime = media.duration - .15; });
    await page.waitForFunction(() => __HYPERDRIVE__.snapshot().performanceSet.done);
    assert.equal(await page.evaluate(() => __HYPERDRIVE__.snapshot().performanceSet.interrupted), false);
    assert.equal(await page.evaluate(() => JSON.stringify(__HYPERDRIVE__.snapshot().state)), baseline);
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    for (const [width, height] of [[390, 667], [320, 740], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: resolve(root, `artifacts/browser/game-test/charted-club-${width}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
      const button = await page.locator('#performance-track').boundingBox();
      assert.ok(button.y >= 0 && button.y + button.height <= height, 'song control stays in the cabinet');
      const stage = await page.locator('.viewport').boundingBox();
      assert.ok(stage.height >= 80, 'performance controls cannot squeeze out the stage');
      await page.locator('#pause').click();
      await page.locator('#resume').click();
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log('PASS charted club follows the radio through real seeks, pause, restart and native-HLS track changes');
}
