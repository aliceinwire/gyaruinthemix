import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocket } from 'node:dgram';
import { DatabaseSync } from 'node:sqlite';
import { openAnalytics, parseEvent, japanDay } from '../analytics/store.mjs';
import {
  createDashboardServer,
  passwordHash,
  startAnalytics,
} from '../analytics/server.mjs';
import { classify } from '../scripts/ci-plan.mjs';

const date = Date.parse('2026-11-25T12:00:00Z');
const proxy = '172.25.0.2';
const trusted = new Set([proxy]);
const event = (overrides = {}, now = date) =>
  Buffer.from(
    '<190>Nov 25 12:00:00 analytics: ' +
      JSON.stringify({
        time: String(now / 1000),
        page: '/',
        source: 'instagram',
        device: 'mobile',
        browser: 'safari',
        peer: proxy,
        client: '203.0.113.5',
        status: 200,
        ...overrides,
      }),
  );
const authorization = {
  authorization: `Basic ${Buffer.from('admin:local-test-password').toString('base64')}`,
};
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-analytics-'));
  const store = openAnalytics(directory, {
    now: () => date,
    trustedProxies: () => trusted,
    ...options,
  });
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, directory };
}

test('accepts nginx syslog while excluding malformed, stale and unlisted data', () => {
  assert.equal(parseEvent(event(), date, trusted).page, '/');
  for (const value of [
    Buffer.from('junk'),
    Buffer.alloc(1025),
    event({ time: 'bad' }),
    event({}, date - 61_000),
    event({ page: '/shop/success/?token=private' }),
    event({ page: '/api/catalog' }),
    event({ source: 'https://private.example/path' }),
    event({ device: 'raw-agent' }),
    event({ status: 301 }),
    event({ status: 206 }),
  ])
    assert.equal(parseEvent(value, date, trusted), null);
});

test('client identity requires an exact trusted peer and a valid single IP', () => {
  assert.ok(parseEvent(event(), date, trusted).identity);
  for (const value of [
    event({ peer: '172.25.0.3' }),
    event({ client: '198.51.100.1, 203.0.113.1' }),
    event({ client: '' }),
    event({ browser: 'raw-agent' }),
  ])
    assert.equal(parseEvent(value, date, trusted).identity, null);
  assert.equal(parseEvent(event(), date).identity, null);
});

test('daily visitors deduplicate across pages without reducing page requests', async (t) => {
  const { store } = await fixture(t);
  store.record(event());
  store.record(event({ page: '/music/' }));
  store.record(event({ client: '203.0.113.6' }));
  store.record(event({ page: '/contact/', status: 503 }));
  const data = store.report();
  assert.equal(data.views, 3);
  assert.equal(data.visitors, 2);
  assert.equal(data.errors, 1);
  assert.equal(data.identifiedRequests, 3);
  assert.deepEqual(data.pages, [
    { name: '/', count: 2 },
    { name: '/music/', count: 1 },
  ]);
  assert.equal(data.daily.at(-1).visitors, 2);
  assert.equal(data.daily.length, 7);
  assert.equal(data.daily[0].views, null);
  assert.equal(data.sources[0].name, 'instagram');
  assert.throws(() => store.report(100));
});

test('unknown addresses keep page totals but do not invent visitor estimates', async (t) => {
  const { store } = await fixture(t, { trustedProxies: () => new Set() });
  store.record(event());
  const data = store.report();
  assert.equal(data.views, 1);
  assert.equal(data.visitors, 0);
  assert.equal(data.identifiedRequests, 0);
  assert.equal(data.visitorCountingReady, false);
  assert.equal(data.daily.at(-1).visitors, null);
});

test('JST rollover counts returning visitors again and retires old salts', async (t) => {
  let now = Date.parse('2026-11-25T14:59:59Z');
  const { store, directory } = await fixture(t, { now: () => now });
  store.record(event({}, now));
  assert.equal(japanDay(now), '2026-11-25');
  now += 2000;
  store.record(event({}, now));
  store.record(event({}, now));
  assert.equal(japanDay(now), '2026-11-26');
  const data = store.report();
  assert.equal(data.visitors, 2);
  assert.equal(data.views, 3);
  assert.deepEqual(
    data.daily.slice(-2).map((day) => day.visitors),
    [1, 1],
  );
  const db = new DatabaseSync(join(directory, 'analytics.sqlite'), {
    readOnly: true,
  });
  assert.deepEqual(
    db
      .prepare('SELECT day FROM salts')
      .all()
      .map((row) => row.day),
    ['2026-11-26'],
  );
  assert.equal(
    new Set(
      db
        .prepare('SELECT fingerprint FROM visitors')
        .all()
        .map((row) => row.fingerprint),
    ).size,
    2,
  );
  db.close();
});

test('persistence keeps visitor deduplication across restarts and saves no raw identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-restart-'));
  const options = { now: () => date, trustedProxies: () => trusted };
  try {
    let store = openAnalytics(directory, options);
    store.record(event());
    store.close();
    store = openAnalytics(directory, options);
    store.record(event());
    assert.equal(store.report().visitors, 1);
    assert.equal(store.report().views, 2);
    store.close();
    const bytes = (
      await readFile(join(directory, 'analytics.sqlite'))
    ).toString('latin1');
    assert.ok(!bytes.includes('203.0.113.5'));
    assert.ok(!bytes.includes(proxy));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retention removes data older than 90 JST calendar days', async (t) => {
  let now = date;
  const { store, directory } = await fixture(t, { now: () => now });
  store.record(event({}, now));
  now += 90 * 86_400_000;
  store.record(event({}, now));
  const data = store.report(90);
  assert.equal(data.views, 1);
  assert.equal(data.visitors, 1);
  assert.equal(data.daily.length, 90);
  const db = new DatabaseSync(join(directory, 'analytics.sqlite'), {
    readOnly: true,
  });
  for (const table of ['counts', 'visitors', 'coverage'])
    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE day='2026-11-25'`)
        .get().n,
      0,
    );
  db.close();
});

test('every dashboard asset and data response requires authentication and forbids caching', async (t) => {
  const { store } = await fixture(t);
  store.record(event());
  const server = createDashboardServer({
    store,
    credential: passwordHash('local-test-password'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of [
    '/analytics/',
    '/analytics/dashboard.mjs',
    '/analytics/dashboard.css',
    '/analytics/data.json',
  ]) {
    const denied = await fetch(base + path);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /Basic/);
    await denied.text();
    const response = await fetch(base + path, { headers: authorization });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    await response.text();
  }
  for (const path of [
    '/analytics/data.json?days=0',
    '/analytics/data.json?days=7x',
  ]) {
    const response = await fetch(base + path, { headers: authorization });
    assert.equal(response.status, 400);
    await response.text();
  }
  const wrong = await fetch(base + '/analytics/', {
    headers: { authorization: 'Basic YWRtaW46d3Jvbmc=' },
  });
  assert.equal(wrong.status, 401);
  await wrong.text();
  const missing = await fetch(base + '/analytics/password.sha256', {
    headers: authorization,
  });
  assert.equal(missing.status, 404);
  await missing.text();
  const method = await fetch(base + '/analytics/data.json', {
    method: 'POST',
    headers: authorization,
  });
  assert.equal(method.status, 405);
  await method.text();
  const data = await fetch(base + '/analytics/data.json?days=30', {
    headers: authorization,
  }).then((response) => response.json());
  assert.equal(data.days, 30);
  assert.equal(data.visitors, 1);
  assert.ok(!JSON.stringify(data).includes('203.0.113.5'));
});

test('loopback syslog delivery appears in the authenticated dashboard', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gyaru-syslog-'));
  await writeFile(
    join(directory, 'password.sha256'),
    passwordHash('local-test-password'),
    { mode: 0o600 },
  );
  const service = await startAnalytics({
    directory,
    httpPort: 0,
    udpPort: 0,
    proxyHost: 'localhost',
  });
  const socket = createSocket('udp4');
  t.after(async () => {
    socket.close();
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) =>
    socket.send(
      event({ peer: '127.0.0.1' }, Date.now()),
      service.udpPort,
      '127.0.0.1',
      (error) => (error ? reject(error) : resolve()),
    ),
  );
  let data;
  for (let attempt = 0; attempt < 20; attempt++) {
    data = await fetch(
      `http://127.0.0.1:${service.httpPort}/analytics/data.json`,
      { headers: authorization },
    ).then((response) => response.json());
    if (data.views) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(data.views, 1);
  assert.equal(data.visitors, 1);
});

test('analytics runtime changes rebuild both web images', () => {
  for (const path of [
    'analytics/store.mjs',
    'analytics/public/dashboard.mjs',
    'deploy/analytics-maps.conf',
  ])
    assert.deepEqual(classify(path).build, ['web', 'web-api']);
});

test('failed collection returns unavailable instead of presenting stale counts as current', async (t) => {
  const { store } = await fixture(t);
  const server = createDashboardServer({
    store,
    credential: passwordHash('local-test-password'),
    healthy: () => false,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/analytics/data.json`,
    { headers: authorization },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'Analytics are temporarily unavailable.');
});
