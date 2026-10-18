import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMemberAccess,
  createResendLoginMailer,
} from '../api/member-access.mjs';

async function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  const app = Fastify();
  await app.register(rateLimit, { global: false });
  const mails = [];
  let now = 1800000000000;
  let entitled = true;
  const config = {
    memberAuthEnabled: true,
    siteOrigin: 'https://store.example',
    mode: 'test',
    ...options.config,
  };
  const access = createMemberAccess({
    db,
    config,
    clock: () => now,
    sendLoginEmail: async (mail) => mails.push(mail),
    membershipForAccount: async (id) => {
      assert.match(id, /^[0-9a-f-]{36}$/);
      return { entitled };
    },
  });
  access.registerRoutes(app);
  t.after(async () => {
    await app.close();
    db.close();
  });
  const post = (url, payload, cookie, origin = config.siteOrigin) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin, ...(cookie ? { cookie } : {}) },
      payload,
    });
  async function login(email = 'member@example.com') {
    const request = await post('/api/member/login/request', {
      email,
      locale: 'en',
    });
    const browserCookie = request.headers['set-cookie'].split(';')[0];
    const token = new URL(mails.at(-1).url).hash.slice('#login='.length);
    const result = await post(
      '/api/member/login/redeem',
      { token },
      browserCookie,
    );
    assert.equal(result.statusCode, 200);
    return {
      cookie: result.headers['set-cookie'].split(';')[0],
      token,
      result,
    };
  }
  return {
    app,
    db,
    mails,
    access,
    post,
    login,
    advance: (ms) => {
      now += ms;
    },
    setEntitled: (value) => {
      entitled = value;
    },
  };
}

test('verified email login stores only hashed secrets, single-use token and secure cookie', async (t) => {
  const f = await fixture(t);
  const { cookie, token, result } = await f.login('MEMBER@example.com');
  assert.match(
    result.headers['set-cookie'],
    /HttpOnly; Secure; SameSite=Strict/,
  );
  assert.match(cookie, /^__Host-gyaru_member_test=/);
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM member_login_tokens').get().n,
    0,
  );
  assert.notEqual(
    f.db.prepare('SELECT hash FROM member_sessions').get().hash,
    cookie.split('=')[1],
  );
  assert.equal(
    (await f.post('/api/member/login/redeem', { token })).statusCode,
    400,
  );
  const session = await f.app.inject({
    url: '/api/member/session',
    headers: { cookie },
  });
  assert.deepEqual(session.json(), {
    authenticated: true,
    member: true,
    email: 'member@example.com',
  });
  assert.match(session.headers['cache-control'], /no-store/);
  assert.equal(
    (await f.app.inject({ url: `/fanclub/#login=${token}` })).statusCode,
    404,
  );
});

test('expiry, recovery revocation, logout and mode isolation fail closed', async (t) => {
  const f = await fixture(t);
  const requested = await f.post('/api/member/login/request', {
    email: 'member@example.com',
  });
  const token = new URL(f.mails[0].url).hash.slice(7);
  f.advance(900001);
  assert.equal(
    (
      await f.post(
        '/api/member/login/redeem',
        { token },
        requested.headers['set-cookie'].split(';')[0],
      )
    ).statusCode,
    400,
  );
  const first = await f.login();
  f.advance(60001);
  const second = await f.login();
  assert.equal(
    f.access.accountForRequest({ headers: { cookie: first.cookie } }),
    null,
  );
  assert.ok(f.access.accountForRequest({ headers: { cookie: second.cookie } }));
  const live = createMemberAccess({
    db: f.db,
    config: {
      mode: 'live',
      memberAuthEnabled: true,
      siteOrigin: 'https://store.example',
    },
    sendLoginEmail: async () => {},
    membershipForAccount: async () => ({ entitled: true }),
  });
  assert.equal(
    live.accountForRequest({
      headers: { cookie: second.cookie.replace('_test=', '_live=') },
    }),
    null,
  );
  assert.equal(
    (await f.post('/api/member/logout', {}, second.cookie)).statusCode,
    200,
  );
  assert.equal(
    f.access.accountForRequest({ headers: { cookie: second.cookie } }),
    null,
  );
  f.advance(60001);
  const third = await f.login();
  f.advance(31 * 86400000);
  assert.equal(
    f.access.accountForRequest({ headers: { cookie: third.cookie } }),
    null,
  );
});

test('all mutations enforce exact HTTPS origin, login generic responses and email cooldown', async (t) => {
  const f = await fixture(t);
  for (const path of ['request', 'redeem']) {
    assert.equal(
      (
        await f.post(
          `/api/member/login/${path}`,
          {},
          undefined,
          'https://evil.example',
        )
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (await f.post('/api/member/logout', {}, undefined, 'https://evil.example'))
      .statusCode,
    403,
  );
  const invalid = await f.post('/api/member/login/request', {
    email: 'invalid',
  });
  const valid = await f.post('/api/member/login/request', {
    email: 'member@example.com',
  });
  assert.deepEqual(invalid.json(), valid.json());
  await f.post('/api/member/login/request', { email: 'member@example.com' });
  assert.equal(f.mails.length, 1);
  await f.post('/api/member/login/request', { email: 'other@example.com' });
  assert.equal(
    (await f.post('/api/member/login/request', { email: 'third@example.com' }))
      .statusCode,
    429,
  );
});

test('insecure origin disables authentication', async (t) => {
  const f = await fixture(t, {
    config: { siteOrigin: 'http://store.example' },
  });
  assert.equal(f.access.enabled, false);
  assert.equal(
    (await f.post('/api/member/login/request', { email: 'member@example.com' }))
      .statusCode,
    503,
  );
});

test('protected content rechecks entitlement, only manifest images, safe path containment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'members-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDir = join(root, 'private');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(privateDir);
  await writeFile(join(root, 'outside.jpg'), 'PRIVATE OUTSIDE');
  await writeFile(join(privateDir, 'photo.jpg'), 'PHOTO');
  await writeFile(join(privateDir, 'unlisted.jpg'), 'UNLISTED');
  await symlink(join(root, 'outside.jpg'), join(privateDir, 'escape.jpg'));
  await writeFile(
    join(privateDir, 'posts.json'),
    JSON.stringify({
      posts: [
        {
          id: 'one',
          title: 'Title',
          body: 'Body',
          publishedAt: '2026-10-18',
          assets: [
            { name: 'photo.jpg', alt: 'Photo' },
            { name: 'escape.jpg', alt: 'Escape' },
          ],
        },
      ],
    }),
  );
  const f = await fixture(t, {
    config: { memberContentDirectory: privateDir },
  });
  assert.equal((await f.app.inject('/api/member/posts')).statusCode, 401);
  assert.equal(
    (await f.app.inject('/api/member/assets/photo.jpg')).statusCode,
    401,
  );
  const { cookie } = await f.login();
  const get = (url) => f.app.inject({ url, headers: { cookie } });
  assert.equal((await get('/api/member/posts')).json().posts.length, 1);
  const photo = await get('/api/member/assets/photo.jpg');
  assert.equal(photo.body, 'PHOTO');
  assert.equal(photo.headers['content-type'], 'image/jpeg');
  assert.match(photo.headers['cache-control'], /no-store/);
  for (const path of [
    'escape.jpg',
    'unlisted.jpg',
    '%2e%2e%2foutside.jpg',
    'posts.json',
  ])
    assert.equal((await get(`/api/member/assets/${path}`)).statusCode, 404);
  f.setEntitled(false);
  assert.equal((await get('/api/member/posts')).statusCode, 403);
  assert.equal((await get('/api/member/assets/photo.jpg')).statusCode, 403);
});

test('sessions survive reopening the durable SQLite database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'member-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let db = new DatabaseSync(join(directory, 'members.sqlite'));
  const config = {
    mode: 'test',
    siteOrigin: 'https://store.example',
    memberAuthEnabled: true,
  };
  const mails = [];
  const opts = {
    config,
    sendLoginEmail: async (mail) => mails.push(mail),
    membershipForAccount: async () => ({ entitled: true }),
  };
  const app = Fastify();
  createMemberAccess({ db, ...opts }).registerRoutes(app);
  const headers = { origin: config.siteOrigin };
  const loginRequest = await app.inject({
    method: 'POST',
    url: '/api/member/login/request',
    headers,
    payload: { email: 'member@example.com' },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/member/login/redeem',
    headers: {
      ...headers,
      cookie: loginRequest.headers['set-cookie'].split(';')[0],
    },
    payload: { token: new URL(mails[0].url).hash.slice(7) },
  });
  const cookie = response.headers['set-cookie'].split(';')[0];
  await app.close();
  db.close();
  db = new DatabaseSync(join(directory, 'members.sqlite'));
  const reopened = createMemberAccess({ db, ...opts });
  assert.equal(
    reopened.accountForRequest({ headers: { cookie } }).email,
    'member@example.com',
  );
  db.close();
});

test('Resend sends bounded HTTPS request with escaped URL and no redirects', async () => {
  let sent;
  const mailer = createResendLoginMailer({
    apiKey: 'test-key',
    from: 'members@example.com',
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return { ok: true };
    },
  });
  await mailer({
    email: 'member@example.com',
    locale: 'en',
    url: 'https://store.example/fanclub/#login=a&b="x"',
  });
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.options.redirect, 'error');
  assert.match(JSON.parse(sent.options.body).html, /a&amp;b=&quot;x&quot;/);
});

test('browser-bound links prevent login CSRF and GET scanners do not consume tokens', async (t) => {
  const f = await fixture(t);
  const request = await f.post('/api/member/login/request', {
    email: 'attacker@example.com',
  });
  const token = new URL(f.mails[0].url).hash.slice(7);
  const browserCookie = request.headers['set-cookie'].split(';')[0];
  const otherBrowser = '__Host-gyaru_login_test=' + 'a'.repeat(43);
  assert.equal(
    (await f.post('/api/member/login/redeem', { token }, otherBrowser))
      .statusCode,
    400,
  );
  assert.equal(
    (await f.post('/api/member/login/redeem', { token })).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/member/login/redeem?token=' + token,
        headers: { cookie: browserCookie },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM member_login_tokens').get().n,
    1,
  );
  assert.equal(
    (await f.post('/api/member/login/redeem', { token }, browserCookie))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.post('/api/member/login/redeem', { token }, browserCookie))
      .statusCode,
    400,
  );
});
