import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isEventTimestamp, selectEvents } from '../src/data/events.mjs';
import { refreshEventLists } from '../src/scripts/events.mjs';

const site = JSON.parse(
  await readFile(new URL('../config/site.json', import.meta.url), 'utf8'),
);
const readSource = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

function eventGroup(period, events) {
  const rows = events.map((event) => ({
    dataset: {
      eventDate: event.date,
      eventEndDate: event.endDate,
      eventEndAt: event.endAt,
      eventCancelled: String(Boolean(event.cancelled)),
    },
    hidden: false,
  }));
  const list = { hidden: false };
  const empty = { hidden: true };
  return {
    dataset: { eventPeriod: period },
    rows,
    list,
    empty,
    querySelectorAll: () => rows,
    querySelector: (selector) =>
      selector === '[data-event-rows]' ? list : empty,
  };
}

test('an old static render refreshes on the client into the correct upcoming and archive sections', () => {
  const media = site.events.filter((event) => event.category === 'media');
  const upcoming = eventGroup('upcoming', media);
  const archive = eventGroup('past', media);
  const root = { querySelectorAll: () => [upcoming, archive] };
  refreshEventLists(root, new Date('2026-09-29T17:28:59Z'));
  assert.equal(upcoming.rows[0].hidden, false);
  assert.equal(archive.rows[0].hidden, true);
  assert.equal(upcoming.empty.hidden, true);
  assert.equal(archive.empty.hidden, false);
  refreshEventLists(root, new Date('2026-10-02T07:00:00Z'));
  assert.equal(upcoming.rows[0].hidden, true);
  assert.equal(upcoming.list.hidden, true);
  assert.equal(upcoming.empty.hidden, false);
  assert.equal(archive.rows[0].hidden, false);
  assert.equal(archive.list.hidden, false);
  assert.equal(archive.empty.hidden, true);
  // Repeated refreshes must not duplicate or change the visibility state.
  refreshEventLists(root, new Date('2026-10-02T07:00:01Z'));
  assert.equal(archive.rows.length, 1);
  assert.equal(archive.rows[0].hidden, false);
});

test('client updates promptly at exact broadcast and Japan midnight boundaries', () => {
  const media = site.events.filter((event) => event.category === 'media');
  const root = { querySelectorAll: () => [eventGroup('upcoming', media)] };
  assert.equal(
    refreshEventLists(root, new Date('2026-09-29T17:28:59Z')),
    1_020,
  );
  assert.equal(
    refreshEventLists(root, new Date('2026-09-30T14:59:59Z')),
    1_020,
  );
});

test('client keeps cancelled events separate before and after the advertised date', () => {
  const cancelled = site.events.filter((event) => event.cancelled);
  const groups = ['upcoming', 'past', 'cancelled'].map((period) =>
    eventGroup(period, cancelled),
  );
  const root = { querySelectorAll: () => groups };
  for (const now of [
    new Date('2026-10-02T07:00:00Z'),
    new Date('2026-10-04T00:00:00Z'),
  ]) {
    refreshEventLists(root, now);
    assert.deepEqual(
      groups.map((group) => group.rows[0].hidden),
      [true, true, false],
    );
  }
});

test('published media has the actual JST times and a neutral ABEMA episode link', () => {
  const broadcast = site.events.find((event) => event.category === 'media');
  assert.equal(broadcast.date, '2026-09-30');
  assert.equal(broadcast.startAt, '2026-09-30T01:59:00+09:00');
  assert.equal(broadcast.endAt, '2026-09-30T02:29:00+09:00');
  assert.equal(broadcast.url, 'https://abema.tv/video/episode/604-1_s1_p243');
  assert.equal(broadcast.linkLabel, 'ABEMAのエピソードページ');
  assert.doesNotMatch(JSON.stringify(broadcast), /無料|配信期限|無料期間/);
  assert.deepEqual(
    selectEvents(site.events, { now: new Date('2026-10-02T07:00:00Z') }),
    [],
  );
});

test('editorial event timestamps require real dates and explicit timezones', () => {
  for (const value of ['2026-09-30T01:59:00+09:00', '2026-09-29T16:59:00Z'])
    assert.equal(isEventTimestamp(value), true);
  for (const value of [
    undefined,
    '2026-09-30',
    '2026-09-30T01:59:00',
    '2026-02-30T01:59:00+09:00',
    '2026-09-30T25:59:00+09:00',
    '2026-09-30T01:60:00+09:00',
  ])
    assert.equal(isEventTimestamp(value), false);
});

test('official contact and member destinations are explicit, without opening sales or unreleased tracks', async () => {
  assert.equal(site.bookingUrl, 'https://www.instagram.com/gyaruinthemix/');
  assert.deepEqual(
    site.socials.map((social) => social.url),
    [
      'https://www.instagram.com/gyaruinthemix/',
      'https://www.instagram.com/arisu_gyaru/',
      'https://www.instagram.com/_sana.0403/',
    ],
  );
  const contact = await readSource('pages/contact.astro');
  assert.match(contact, /出演依頼・お問い合わせ/);
  assert.match(contact, /公式InstagramのDM/);
  assert.match(contact, /B2B DJユニット/);
  assert.match(
    await readSource('layouts/Layout.astro'),
    /\['\/contact\/', '出演依頼・お問い合わせ'\]/,
  );
  for (const page of ['legal', 'privacy']) {
    const source = await readSource(`pages/${page}.astro`);
    assert.match(source, /href="\/contact\/"/);
    assert.doesNotMatch(source, /販売開始前にお問い合わせ先をご案内/);
  }
  assert.equal(site.tracks.length, 4);
  assert.equal(
    site.tracks.every((track) => track.url === ''),
    true,
  );
  assert.equal(site.fanClub.registrationOpen, false);
  assert.equal(site.fanClub.joinUrl, '');
  const cancelled = site.events.find((event) => event.cancelled);
  assert.equal(cancelled.date, '2026-10-03');
  assert.equal(cancelled.url, '');
});
