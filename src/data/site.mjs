import data from '../../config/site.json';
import { isCalendarDate, isEventTimestamp, japanDate } from './events.mjs';

// Editorial links are public, build-time data. Never put tokens or secrets here.
function safeLink(value, { local = false } = {}) {
  if (!value) return '';
  if (local && /^\/(?!\/)[a-z0-9/_-]*$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password)
      return url.href;
  } catch {
    /* Invalid editorial links fail the build. */
  }
  throw new Error('Site links must use HTTPS without embedded credentials');
}
if (data.fanClub.registrationOpen && !data.fanClub.joinUrl)
  throw new Error('Open fan-club registration requires a join URL');

export const site = {
  ...data,
  bookingUrl: safeLink(data.bookingUrl),
  soundcloudUrl: safeLink(data.soundcloudUrl),
  socials: data.socials.map((item) => ({ ...item, url: safeLink(item.url) })),
  fanClub: { ...data.fanClub, joinUrl: safeLink(data.fanClub.joinUrl) },
  tracks: data.tracks.map((item) => ({ ...item, url: safeLink(item.url) })),
  events: data.events
    .filter((item) => item.published === true)
    .map((item) => {
      if (
        !isCalendarDate(item.date) ||
        (item.endDate !== undefined &&
          (!isCalendarDate(item.endDate) || item.endDate < item.date)) ||
        (item.startAt !== undefined &&
          (!isEventTimestamp(item.startAt) ||
            japanDate(new Date(item.startAt)) !== item.date)) ||
        (item.endAt !== undefined &&
          (!isEventTimestamp(item.endAt) ||
            japanDate(new Date(item.endAt)) < item.date ||
            (item.startAt &&
              Date.parse(item.endAt) <= Date.parse(item.startAt)))) ||
        !['live', 'media'].includes(item.category)
      )
        throw new Error(
          'Published events need valid calendar dates, ordered timezone-aware timestamps, and live/media category',
        );
      return { ...item, url: safeLink(item.url) };
    }),
  news: data.news.map((item) => ({
    ...item,
    url: safeLink(item.url, { local: true }),
  })),
};
