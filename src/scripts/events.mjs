import { eventPeriod, japanDate } from '../data/events.mjs';

// Refresh on load, on returning to the page, and across event/Japan-date
// boundaries. This deliberately shares classification with the static build.
export function refreshEventLists(root, now = new Date()) {
  let delay = 60_000;
  const tomorrow = Date.parse(`${japanDate(now)}T00:00:00+09:00`) + 86_400_000;
  delay = Math.min(delay, tomorrow - now.getTime() + 20);
  for (const group of root.querySelectorAll('[data-event-period]')) {
    let visible = 0;
    for (const row of group.querySelectorAll('[data-event-row]')) {
      const event = {
        date: row.dataset.eventDate,
        endDate: row.dataset.eventEndDate,
        endAt: row.dataset.eventEndAt,
        cancelled: row.dataset.eventCancelled === 'true',
      };
      row.hidden = eventPeriod(event, { now }) !== group.dataset.eventPeriod;
      if (!row.hidden) visible += 1;
      const untilEnd = Date.parse(event.endAt) - now.getTime();
      if (untilEnd > 0 && !event.cancelled)
        delay = Math.min(delay, untilEnd + 20);
    }
    group.querySelector('[data-event-rows]').hidden = visible === 0;
    group.querySelector('[data-event-empty]').hidden = visible > 0;
  }
  return Math.max(20, delay);
}

export function startEventRefresh() {
  let timer;
  function update() {
    window.clearTimeout(timer);
    const delay = refreshEventLists(document);
    timer = window.setTimeout(update, delay);
  }
  update();
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
}
