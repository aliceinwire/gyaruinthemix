import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

const sections = [
  'about',
  'music',
  'podcast',
  'live',
  'news',
  'fanclub',
  'shop',
  'contact',
  'legal',
  'privacy',
];
export const pages = new Set([
  '/',
  '/en/',
  '/game/',
  ...sections.flatMap((name) => [`/${name}/`, `/en/${name}/`]),
]);
export const sources = new Set([
  'direct',
  'internal',
  'instagram',
  'tiktok',
  'google',
  'bing',
  'x',
  'youtube',
  'facebook',
  'other',
]);
export const devices = new Set(['desktop', 'mobile', 'tablet', 'unknown']);
export const browsers = new Set([
  'firefox',
  'edge',
  'chrome',
  'safari',
  'other',
]);
const dayLength = 86_400_000;
export const japanDay = (time) =>
  new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);

// Only values already reduced to fixed categories by nginx reach this database.
export function parseEvent(
  message,
  now = Date.now(),
  trustedProxies = new Set(),
) {
  if (message.length > 1024) return null;
  const text = message.toString();
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const value = JSON.parse(text.slice(start));
    const time = Number(value.time) * 1000;
    if (
      !Number.isFinite(time) ||
      Math.abs(now - time) > 60_000 ||
      !pages.has(value.page) ||
      !sources.has(value.source) ||
      !devices.has(value.device) ||
      ![200, 304, 400, 401, 403, 404, 408, 429, 500, 502, 503, 504].includes(
        value.status,
      )
    )
      return null;
    const client =
      trustedProxies.has(value.peer) &&
      typeof value.client === 'string' &&
      isIP(value.client)
        ? value.client
        : null;
    return {
      day: japanDay(time),
      page: value.page,
      source: value.source,
      device: value.device,
      outcome: value.status < 400 ? 'view' : 'error',
      identity:
        client && browsers.has(value.browser)
          ? `${client}|${value.browser}|${value.device}`
          : null,
    };
  } catch {
    return null;
  }
}

export function openAnalytics(
  directory,
  { now = Date.now, trustedProxies = () => new Set() } = {},
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'analytics.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    PRAGMA busy_timeout=1000; PRAGMA cache_size=-1024;
    PRAGMA max_page_count=8192; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS counts (
      day TEXT NOT NULL, page TEXT NOT NULL, source TEXT NOT NULL,
      device TEXT NOT NULL, outcome TEXT NOT NULL, total INTEGER NOT NULL,
      PRIMARY KEY (day, page, source, device, outcome)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY (day, fingerprint)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS coverage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run(
    'startedAt',
    new Date(now()).toISOString(),
  );
  const increment = db.prepare(`INSERT INTO counts VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT (day, page, source, device, outcome) DO UPDATE SET total=total+1`);
  const prune = () => {
    const cutoff = japanDay(now() - 89 * dayLength);
    for (const table of ['counts', 'visitors', 'coverage'])
      db.prepare(`DELETE FROM ${table} WHERE day < ?`).run(cutoff);
    db.prepare('DELETE FROM salts WHERE day < ?').run(japanDay(now()));
  };
  prune();
  let currentDay = japanDay(now());
  return {
    prune,
    record(message) {
      const event = parseEvent(message, now(), trustedProxies());
      if (!event) return false;
      const today = japanDay(now());
      if (currentDay !== today) {
        prune();
        currentDay = today;
      }
      // Late datagrams from yesterday cannot recreate a discarded daily salt.
      const identity =
        event.day === today && event.outcome === 'view' ? event.identity : null;
      db.exec('BEGIN');
      try {
        increment.run(
          event.day,
          event.page,
          event.source,
          event.device,
          event.outcome,
        );
        if (identity) {
          db.prepare('INSERT OR IGNORE INTO salts VALUES (?, ?)').run(
            today,
            randomBytes(32).toString('hex'),
          );
          const salt = db
            .prepare('SELECT value FROM salts WHERE day=?')
            .get(today).value;
          const fingerprint = createHmac('sha256', salt)
            .update(identity)
            .digest('hex');
          db.prepare('INSERT OR IGNORE INTO visitors VALUES (?, ?)').run(
            today,
            fingerprint,
          );
          db.prepare(
            'INSERT INTO coverage VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET requests=requests+1',
          ).run(today);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return true;
    },
    report(days = 7) {
      if (![7, 30, 90].includes(days)) throw new Error('Invalid period');
      prune();
      const end = japanDay(now());
      const start = japanDay(now() - (days - 1) * dayLength);
      const rows = db
        .prepare('SELECT * FROM counts WHERE day >= ? AND day <= ?')
        .all(start, end);
      const daily = Array.from({ length: days }, (_, i) => ({
        date: japanDay(now() - (days - i - 1) * dayLength),
        visitors: 0,
        views: 0,
        errors: 0,
      }));
      const breakdowns = {
        pages: new Map(),
        sources: new Map(),
        devices: new Map(),
      };
      let views = 0,
        errors = 0;
      for (const row of rows) {
        const day = daily.find((value) => value.date === row.day);
        if (row.outcome === 'error') {
          errors += row.total;
          day.errors += row.total;
          continue;
        }
        views += row.total;
        day.views += row.total;
        for (const [key, value] of [
          ['pages', row.page],
          ['sources', row.source],
          ['devices', row.device],
        ])
          breakdowns[key].set(
            value,
            (breakdowns[key].get(value) || 0) + row.total,
          );
      }
      let visitors = 0;
      for (const row of db
        .prepare(
          'SELECT day, COUNT(*) AS total FROM visitors WHERE day >= ? AND day <= ? GROUP BY day',
        )
        .all(start, end)) {
        daily.find((value) => value.date === row.day).visitors = row.total;
        visitors += row.total;
      }
      const identifiedRequests = db
        .prepare(
          'SELECT COALESCE(SUM(requests), 0) AS total FROM coverage WHERE day >= ? AND day <= ?',
        )
        .get(start, end).total;
      const startedAt = db
        .prepare("SELECT value FROM metadata WHERE key='startedAt'")
        .get().value;
      const firstDay = japanDay(Date.parse(startedAt));
      for (const day of daily) {
        if (day.date < firstDay) {
          day.views = null;
          day.errors = null;
          day.visitors = null;
        } else if (day.views > 0 && day.visitors === 0) day.visitors = null;
      }
      return {
        generatedAt: new Date(now()).toISOString(),
        startedAt,
        timezone: 'Asia/Tokyo',
        start,
        end,
        days,
        visitors,
        identifiedRequests,
        visitorCountingReady: trustedProxies().size > 0,
        views,
        errors,
        daily,
        ...Object.fromEntries(
          Object.entries(breakdowns).map(([key, values]) => [
            key,
            [...values]
              .map(([name, count]) => ({ name, count }))
              .sort(
                (a, b) => b.count - a.count || a.name.localeCompare(b.name),
              ),
          ]),
        ),
      };
    },
    close() {
      db.close();
    },
  };
}
