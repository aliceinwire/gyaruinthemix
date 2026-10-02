export function japanDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

export function isEventTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/,
  );
  return Boolean(
    match && isCalendarDate(match[1]) && Number.isFinite(Date.parse(value)),
  );
}

// Use a precise end time when supplied; date-only events last through their
// final Japan calendar day. Explicit `today` remains useful for day-level views.
export function eventPeriod(event, { now, today } = {}) {
  if (event.cancelled) return 'cancelled';
  const instant =
    now ?? (today ? new Date(`${today}T00:00:00+09:00`) : new Date());
  const ended = event.endAt
    ? Date.parse(event.endAt) <= instant.getTime()
    : (event.endDate || event.date) < (today ?? japanDate(instant));
  return ended ? 'past' : 'upcoming';
}

// Shared by the static render and browser refresh, so an older build cannot
// leave a finished appearance in its upcoming list after the page is opened.
export function selectEvents(
  events,
  { period = 'upcoming', category, now, today } = {},
) {
  return events
    .filter((event) => {
      if (event.published !== true || (category && event.category !== category))
        return false;
      return eventPeriod(event, { now, today }) === period;
    })
    .sort((a, b) =>
      period === 'past'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date),
    );
}
