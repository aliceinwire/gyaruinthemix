import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const japanese = JSON.parse(
  await readFile(new URL('../config/site.json', import.meta.url), 'utf8'),
);
const english = JSON.parse(
  await readFile(new URL('../config/site.en.json', import.meta.url), 'utf8'),
);
const source = await readFile(
  new URL('../src/data/site.mjs', import.meta.url),
  'utf8',
);

// Astro resolves JSON imports during its build. Inline those same JSON inputs
// here so the module's validation can also be exercised in plain Node.
async function loadSite(data = japanese, translations = english) {
  const moduleSource = source
    .replace(
      "import data from '../../config/site.json';",
      `const data = ${JSON.stringify(data)};`,
    )
    .replace(
      "import english from '../../config/site.en.json';",
      `const english = ${JSON.stringify(translations)};`,
    )
    .replace(
      "'./events.mjs'",
      JSON.stringify(new URL('../src/data/events.mjs', import.meta.url).href),
    );
  return import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
  );
}

const { site, getSite } = await loadSite();

test('Japanese remains the default and English preserves canonical editorial facts', () => {
  assert.equal(getSite(), site);
  assert.equal(getSite('ja'), site);
  assert.equal(getSite('unknown'), site);
  const en = getSite('en');
  assert.equal(en.artist.bpm, 175);
  assert.equal(en.artist.aesthetic, 'Heisei tsuyome gyaru');
  assert.deepEqual(
    en.artist.genres.map((genre) => genre.name),
    site.artist.genres.map((genre) => genre.name),
  );
  assert.equal(en.bookingUrl, site.bookingUrl);
  assert.equal(en.soundcloudUrl, site.soundcloudUrl);
  assert.deepEqual(
    en.socials.map((social) => social.url),
    site.socials.map((social) => social.url),
  );
  assert.match(en.socials[1].label, /DJ Arinee/);
  assert.match(en.socials[2].label, /DJ Chana/);
  assert.equal(en.fanClub.registrationOpen, false);
  assert.equal(en.fanClub.joinUrl, '');
  assert.deepEqual(
    en.tracks.map(({ title, url }) => ({ title, url })),
    site.tracks.map(({ title, url }) => ({ title, url })),
  );
  const eventFacts = ({
    published,
    category,
    date,
    startAt,
    endAt,
    cancelled,
    url,
  }) => ({ published, category, date, startAt, endAt, cancelled, url });
  assert.deepEqual(en.events.map(eventFacts), site.events.map(eventFacts));
  const photoFacts = ({ image, width, height }) => ({ image, width, height });
  assert.deepEqual(en.photos.map(photoFacts), site.photos.map(photoFacts));
});

test('English editorial data retains cancellations, broadcast precision, and pending release status', () => {
  const en = getSite('en');
  const cancelled = en.events.find((event) => event.cancelled);
  assert.match(cancelled.title, /October 3.*cancelled/);
  assert.match(cancelled.note, /has been cancelled/);
  const media = en.events.find((event) => event.category === 'media');
  assert.equal(media.title, 'アキナのギャルしか勝たん');
  assert.equal(media.startAt, '2026-09-30T01:59:00+09:00');
  assert.equal(media.endAt, '2026-09-30T02:29:00+09:00');
  assert.match(media.note, /Japan Standard Time/);
  assert.match(media.timeLabel, /September 30.*September 29/);
  assert.equal(media.linkLabel, 'ABEMA episode page');
  assert.match(en.news[1].text, /will be announced once confirmed/);
  assert.match(en.fanClub.membershipNote, /when registration opens/);
  for (const photo of en.photos) {
    assert.ok(photo.alt.length > 15);
    assert.ok(photo.caption);
    assert.ok(photo.tag);
    assert.doesNotMatch(
      `${photo.alt} ${photo.caption} ${photo.tag}`,
      /[ぁ-んァ-ン一-龯]/u,
    );
  }
});

test('English overrides cannot change destinations, dates, or membership status', async () => {
  for (const change of [
    (data) => {
      data.socials[0].url = 'https://example.com/';
    },
    (data) => {
      data.events[0].date = '2027-01-01';
    },
    (data) => {
      data.fanClub.registrationOpen = true;
    },
    (data) => {
      data.photos[0].image = '/assets/other.webp';
    },
  ]) {
    const translations = structuredClone(english);
    change(translations);
    await assert.rejects(
      loadSite(japanese, translations),
      /Invalid English editorial field/,
    );
  }
});

test('missing or mismatched translations fail validation instead of silently mixing languages', async () => {
  const missing = structuredClone(english);
  delete missing.photos[0].alt;
  await assert.rejects(
    loadSite(japanese, missing),
    /Missing English editorial field/,
  );
  const mismatch = structuredClone(english);
  mismatch.events.pop();
  await assert.rejects(
    loadSite(japanese, mismatch),
    /must match the source items/,
  );
});

test('shared safety validation still rejects unsafe canonical links and dates', async () => {
  const unsafeLink = structuredClone(japanese);
  unsafeLink.bookingUrl = 'javascript:alert(1)';
  await assert.rejects(loadSite(unsafeLink), /Site links must use HTTPS/);
  const invalidDate = structuredClone(japanese);
  invalidDate.events[0].date = '2026-02-30';
  await assert.rejects(
    loadSite(invalidDate),
    /Published events need valid calendar dates/,
  );
});
