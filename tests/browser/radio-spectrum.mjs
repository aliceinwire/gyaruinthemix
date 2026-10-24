import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

function alternatingTone() {
  const sampleRate = 44100, samples = sampleRate * 6;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const time = i / sampleRate;
    const frequency = Math.floor(time * 2) % 2 ? 6500 : 90;
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * time) * 16000), 44 + i * 2);
  }
  return wav;
}

/** Real HTML media and Web Audio, with only the streaming service replaced. */
export async function checkRadioSpectrum(browser, { root, csp }) {
  const origin = 'http://radio-test.local';
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = alternatingTone();
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': csp },
      body: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/game-test/car-stereo.css"></head><body><div id="radio"></div><canvas id="world" width="960" height="540"></canvas></body></html>',
    });
    if (url.pathname === '/tone.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    try {
      return route.fulfill({
        contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.avif': 'image/avif', '.webp': 'image/webp' })[extname(url.pathname)],
        body: await readFile(resolve(root, 'dist', url.pathname.slice(1))),
      });
    } catch {
      errors.push(`Missing radio asset: ${url.pathname}`);
      return route.fulfill({ status: 404, body: 'Not found' });
    }
  });
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      const { createCarStereo } = await import('/game-test/src/car-stereo.js');
      const { createGameAudio, createStreamingAudio } = await import('/game-test/src/audio.js');
      const { createState } = await import('/game-test/src/simulation.js');
      const { render } = await import('/game-test/src/renderer.js');
      const { prepareGameArt } = await import('/game-test/src/resources.js');
      const controllerFactory = ({ media, onState }) => {
          const track = { id: 'tone', title: 'Frequency fixture', duration: 6 };
          media.src = '/tone.wav';
          const state = () => ({ catalog: [track], track, status: media.paused ? 'paused' : 'playing',
            enabled: !media.paused, playing: !media.paused, muted: media.muted, volume: media.volume,
            currentTime: media.currentTime, duration: media.duration || 6 });
          const emit = () => onState(state());
          const events = ['playing', 'pause', 'ended', 'volumechange', 'timeupdate'];
          events.forEach(event => media.addEventListener(event, emit));
          return {
            get state() { return state(); },
            loadCatalog: emit,
            toggle: () => media.paused ? media.play() : media.pause(),
            previous: () => { media.currentTime = 0; return media.play(); },
            next: () => { media.currentTime = 0; return media.play(); },
            setMuted: value => { media.muted = value; emit(); },
            setVolume: value => { media.volume = Math.max(0, Math.min(1, value)); emit(); },
            seek: value => { media.currentTime = value; },
            destroy: () => { media.pause(); events.forEach(event => media.removeEventListener(event, emit)); },
          };
      };
      globalThis.audioFixture = createGameAudio({
        music: document.querySelector('#radio'),
        loadConfig: async () => true,
        streamingFactory: options => createStreamingAudio({
          ...options,
          stereoFactory: stereoOptions => {
            globalThis.radioFixture = createCarStereo({ ...stereoOptions, controllerFactory });
            return radioFixture;
          },
        }),
      });
      const scene = createState({ mode: 'survival', seed: 'music-world' });
      scene.weather = 'sunny';
      scene.routeLength = 220;
      scene.entities = [
        { id: 1, type: 'ev', distance: 90, radius: 35 },
        { id: 2, type: 'salaryman', distance: 170, headliner: { color: '#ff91cd' }, hp: 3, maxHp: 3 },
      ];
      await prepareGameArt(scene);
      const before = JSON.stringify(scene);
      const canvas = document.querySelector('#world'), ctx = canvas.getContext('2d', { willReadFrequently: true });
      globalThis.captureMusicWorld = () => {
        const music = audioFixture.reactivity;
        render(ctx, scene, { time: 0, music });
        const pixels = ctx.getImageData(645, 345, 90, 120).data;
        let hash = 2166136261;
        for (const value of pixels) hash = Math.imul(hash ^ value, 16777619) >>> 0;
        return { bars: document.querySelector('.stereo-equalizer').textContent, music, world: hash,
          unchanged: before === JSON.stringify(scene) };
      };
    });
    const bars = page.locator('.stereo-equalizer');
    const quiet = await page.evaluate(() => captureMusicWorld());
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').dataset.active === 'true');
    const frames = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 24; i++) {
        samples.push(captureMusicWorld());
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      return samples;
    });
    const heights = value => [...value].map(char => '▁▂▃▄▅▆▇█'.indexOf(char));
    assert.ok(frames.some(({ bars, music }) => heights(bars)[0] > heights(bars)[4] && music.bass > music.treble), 'Bass tone reaches both the radio and game facade');
    assert.ok(frames.some(({ bars, music }) => heights(bars)[4] > heights(bars)[0] && music.treble > music.bass), 'Treble tone reaches both the radio and game facade');
    assert.ok(new Set(frames.map(frame => frame.bars)).size > 2, 'Bars follow changing decoded audio');
    assert.ok(new Set(frames.map(frame => frame.world)).size > 2, 'Speaker artwork follows the decoded signal at a fixed scene time');
    assert.ok(frames.every(frame => frame.unchanged), 'Music rendering leaves simulation state unchanged');
    await mkdir(resolve(root, 'artifacts/browser/game-test'), { recursive: true });
    await page.locator('#world').screenshot({ path: resolve(root, 'artifacts/browser/game-test/music-reactive.png') });
    await page.locator('[data-action="mute"]').click();
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal(await bars.getAttribute('data-active'), 'false');
    assert.equal((await page.evaluate(() => captureMusicWorld())).world, quiet.world);
    await page.locator('[data-action="mute"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.locator('[data-action="play"]').click();
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal((await page.evaluate(() => captureMusicWorld())).music.active, false);
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').dataset.active === 'false');
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal(await page.locator('audio').evaluate(media => media.paused), false);
    assert.equal((await page.evaluate(() => captureMusicWorld())).world, quiet.world);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.evaluate(() => radioFixture.controller.seek(1));
    await page.waitForFunction(() => !radioFixture.media.seeking && audioFixture.reactivity.active);
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    assert.equal(await page.locator('audio').count(), 1);
    await page.locator('audio').evaluate(media => { media.currentTime = media.duration - .1; });
    await page.waitForFunction(() => document.querySelector('audio').ended);
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal((await page.evaluate(() => captureMusicWorld())).world, quiet.world);
    await page.evaluate(() => audioFixture.destroy());
    assert.equal(await page.locator('audio').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS one radio drives speaker artwork with real bass/treble audio and resets on mute/pause/seek/end');
  } finally {
    await context.close();
  }
}
