import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
      body: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/game-test/car-stereo.css"></head><body><div id="radio"></div></body></html>',
    });
    if (url.pathname === '/tone.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
    try {
      return route.fulfill({
        contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(url.pathname)],
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
      globalThis.radioFixture = createCarStereo({
        mount: document.querySelector('#radio'),
        controllerFactory: ({ media, onState }) => {
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
        },
      });
    });
    const bars = page.locator('.stereo-equalizer');
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').dataset.active === 'true');
    const frames = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 24; i++) {
        samples.push(document.querySelector('.stereo-equalizer').textContent);
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      return samples;
    });
    const heights = value => [...value].map(char => '▁▂▃▄▅▆▇█'.indexOf(char));
    assert.ok(frames.some(value => heights(value)[0] > heights(value)[4]), 'Bass tone drives the bass bar');
    assert.ok(frames.some(value => heights(value)[4] > heights(value)[0]), 'Treble tone drives the treble bar');
    assert.ok(new Set(frames).size > 2, 'Bars follow changing decoded audio');
    await page.locator('[data-action="mute"]').click();
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal(await bars.getAttribute('data-active'), 'false');
    await page.locator('[data-action="mute"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.locator('[data-action="play"]').click();
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    await page.locator('[data-action="play"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').dataset.active === 'false');
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    assert.equal(await page.locator('audio').evaluate(media => media.paused), false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    await page.locator('[data-action="next"]').click();
    await page.waitForFunction(() => document.querySelector('.stereo-equalizer').textContent !== '▁▁▁▁▁');
    assert.equal(await page.locator('audio').count(), 1);
    await page.locator('audio').evaluate(media => { media.currentTime = media.duration - .1; });
    await page.waitForFunction(() => document.querySelector('audio').ended);
    assert.equal(await bars.textContent(), '▁▁▁▁▁');
    await page.evaluate(() => radioFixture.destroy());
    assert.equal(await page.locator('audio').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS radio spectrum follows real bass/treble audio and resets on mute/pause/end');
  } finally {
    await context.close();
  }
}
