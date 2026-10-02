import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCalendarDate,
  japanDate,
  selectEvents,
} from '../src/data/events.mjs';

const event = (date, extra = {}) => ({
  date,
  published: true,
  category: 'live',
  ...extra,
});

test('schedule uses the Japan calendar date across the UTC midnight boundary', () => {
  assert.equal(japanDate(new Date('2026-09-24T14:59:59Z')), '2026-09-24');
  assert.equal(japanDate(new Date('2026-09-24T15:00:00Z')), '2026-09-25');
});

test('upcoming appearances include today and sort earliest first without mutating source', () => {
  const entries = [
    event('2026-09-29'),
    event('2026-09-25'),
    event('2026-08-22'),
  ];
  assert.deepEqual(
    selectEvents(entries, { today: '2026-09-25' }).map((item) => item.date),
    ['2026-09-25', '2026-09-29'],
  );
  assert.equal(entries[0].date, '2026-09-29');
});

test('past appearances are archived newest first and omit unpublished entries', () => {
  const entries = [
    event('2026-08-09'),
    event('2026-08-22'),
    event('2026-09-25'),
    event('2026-08-31', { published: false }),
  ];
  assert.deepEqual(
    selectEvents(entries, { period: 'past', today: '2026-09-24' }).map(
      (item) => item.date,
    ),
    ['2026-08-22', '2026-08-09'],
  );
});

test('cancelled appearances stay separate from both upcoming and past bookings', () => {
  const cancelled = event('2026-10-03', { cancelled: true });
  for (const today of ['2026-09-24', '2026-10-04']) {
    assert.deepEqual(selectEvents([cancelled], { today }), []);
    assert.deepEqual(selectEvents([cancelled], { period: 'past', today }), []);
    assert.deepEqual(
      selectEvents([cancelled], { period: 'cancelled', today }),
      [cancelled],
    );
  }
});

test('overnight media appearances remain listed through their actual end date', () => {
  const broadcast = event('2026-09-29', {
    category: 'media',
    endDate: '2026-09-30',
  });
  const entries = [broadcast, event('2026-10-01')];
  assert.deepEqual(
    selectEvents(entries, { category: 'media', today: '2026-09-30' }),
    [broadcast],
  );
  assert.deepEqual(
    selectEvents(entries, { category: 'media', today: '2026-10-01' }),
    [],
  );
  assert.deepEqual(
    selectEvents(entries, { period: 'past', today: '2026-10-01' }),
    [broadcast],
  );
});

test('calendar validation rejects impossible dates and accepts leap days', () => {
  for (const value of [
    '2026-02-29',
    '2026-09-31',
    '2026-13-01',
    '09/25',
    undefined,
  ]) {
    assert.equal(isCalendarDate(value), false);
  }
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-09-25'), true);
});

test('broadcast moves to the archive at its precise JST end time', () => {
  const broadcast = event('2026-09-30', {
    category: 'media',
    startAt: '2026-09-30T01:59:00+09:00',
    endAt: '2026-09-30T02:29:00+09:00',
  });
  for (const instant of ['2026-09-29T16:58:00Z', '2026-09-29T17:28:59.999Z']) {
    assert.deepEqual(selectEvents([broadcast], { now: new Date(instant) }), [
      broadcast,
    ]);
  }
  for (const instant of [
    '2026-09-29T17:29:00Z',
    '2026-09-30T00:00:00Z',
    '2026-10-02T07:00:00Z',
  ]) {
    const now = new Date(instant);
    assert.deepEqual(selectEvents([broadcast], { now }), []);
    assert.deepEqual(selectEvents([broadcast], { period: 'past', now }), [
      broadcast,
    ]);
  }
});

test('date-only events move to the archive at Japan midnight, regardless of the host timezone', () => {
  const entries = [event('2026-09-30')];
  assert.deepEqual(
    selectEvents(entries, { now: new Date('2026-09-30T14:59:59Z') }),
    entries,
  );
  assert.deepEqual(
    selectEvents(entries, { now: new Date('2026-09-30T15:00:00Z') }),
    [],
  );
});

test('an exact end time never moves a cancellation into ordinary listings', () => {
  const cancelled = event('2026-10-03', {
    cancelled: true,
    endAt: '2026-10-03T20:00:00+09:00',
  });
  for (const now of [
    new Date('2026-10-02T07:00:00Z'),
    new Date('2026-10-04T00:00:00Z'),
  ]) {
    assert.deepEqual(selectEvents([cancelled], { now }), []);
    assert.deepEqual(selectEvents([cancelled], { period: 'past', now }), []);
    assert.deepEqual(selectEvents([cancelled], { period: 'cancelled', now }), [
      cancelled,
    ]);
  }
});
