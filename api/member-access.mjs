import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const assetPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/;
const mimeTypes = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};
const generic = { ok: true };
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );

// The API key is injected from the deployment's protected secret file, never a browser bundle.
export function createResendLoginMailer({ apiKey, from, fetchImpl = fetch }) {
  return async ({ email, url, locale }) => {
    const english = locale === 'en';
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: english
          ? 'Your fanclub sign-in link'
          : 'ファンクラブログインリンク',
        text: `${english ? 'Open this link in the same browser that requested it, then confirm sign-in. It expires in 15 minutes. Ignore this email if you did not request it.' : '申請した同じブラウザでリンクを開いてログインを確認してください。有効期限は15分です。心当たりがない場合は無視してください。'}\n${url}`,
        html: `<p>${english ? 'Open in the same browser that requested this link and confirm your fanclub sign-in. This link expires in 15 minutes.' : '申請した同じブラウザでファンクラブログインを確認してください。有効期限は15分です。'}</p><p><a href="${escapeHtml(url)}">${english ? 'Sign in' : 'ログイン'}</a></p>`,
      }),
    });
    if (!response.ok) throw new Error('Login email unavailable');
  };
}

export function createMemberAccess({
  db,
  config,
  membershipForAccount,
  sendLoginEmail,
  clock = Date.now,
}) {
  const mode = config.mode === 'live' ? 'live' : 'test';
  const origin = new URL(config.siteOrigin || config.siteUrl).origin;
  const mailer =
    sendLoginEmail ||
    (config.memberResendApiKey && config.memberEmailFrom
      ? createResendLoginMailer({
          apiKey: config.memberResendApiKey,
          from: config.memberEmailFrom,
        })
      : null);
  const enabled =
    config.memberAuthEnabled === true &&
    origin.startsWith('https://') &&
    Boolean(mailer);
  const cookieName = `__Host-gyaru_member_${mode}`;
  const browserCookieName = `__Host-gyaru_login_${mode}`;
  const sessionMs =
    Math.min(30, Math.max(1, Number(config.memberSessionDays) || 30)) *
    86400000;
  db.exec(`CREATE TABLE IF NOT EXISTS member_accounts (id TEXT PRIMARY KEY, mode TEXT NOT NULL, email TEXT NOT NULL, verified_at INTEGER NOT NULL, UNIQUE(mode,email));
    CREATE TABLE IF NOT EXISTS member_login_tokens (hash TEXT PRIMARY KEY, mode TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL, browser_hash TEXT);
    CREATE TABLE IF NOT EXISTS member_sessions (hash TEXT PRIMARY KEY, mode TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES member_accounts(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS member_email_limits (hash TEXT PRIMARY KEY, requested_at INTEGER NOT NULL);`);
  // Old unbound links are intentionally invalidated by the nullable migration.
  if (
    !db
      .prepare('PRAGMA table_info(member_login_tokens)')
      .all()
      .some((column) => column.name === 'browser_hash')
  )
    db.exec('ALTER TABLE member_login_tokens ADD COLUMN browser_hash TEXT');
  function noStore(reply) {
    reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff');
  }
  function allowed(request, reply) {
    noStore(reply);
    if (!enabled) {
      reply.code(503).send({ error: 'Member access is not configured.' });
      return false;
    }
    if (
      request.method !== 'GET' &&
      (request.headers.origin !== origin ||
        !String(request.headers['content-type'] || '').startsWith(
          'application/json',
        ))
    ) {
      reply.code(403).send({ error: 'Open the fanclub page and try again.' });
      return false;
    }
    return true;
  }
  function sessionToken(request, name = cookieName) {
    const values = String(request.headers.cookie || '')
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(name.length + 1);
    return tokenPattern.test(token) ? token : null;
  }
  function accountForRequest(request) {
    if (!enabled) return null;
    const token = sessionToken(request);
    if (!token) return null;
    return (
      db
        .prepare(
          `SELECT a.id,a.email FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id
      WHERE s.hash=? AND s.mode=? AND a.mode=? AND s.expires_at>?`,
        )
        .get(hash(token), mode, mode, clock()) || null
    );
  }
  async function requireAccount(request, reply) {
    if (!allowed(request, reply)) return null;
    const account = accountForRequest(request);
    if (!account) reply.code(401).send({ error: 'Please sign in.' });
    return account;
  }
  async function requireMember(request, reply) {
    const account = await requireAccount(request, reply);
    if (!account) return null;
    let membership;
    try {
      membership = await membershipForAccount(account.id);
    } catch {
      reply.code(503).send({ error: 'Membership could not be verified.' });
      return null;
    }
    if (!membership?.entitled) {
      reply.code(403).send({ error: 'An active paid membership is required.' });
      return null;
    }
    return account;
  }
  async function privateFile(name, limit) {
    if (!config.memberContentDirectory || !assetPattern.test(name))
      throw new Error('Unavailable');
    const root = await realpath(config.memberContentDirectory);
    const file = await realpath(resolve(root, name));
    if (!file.startsWith(`${root}${sep}`)) throw new Error('Unavailable');
    const info = await stat(file);
    if (!info.isFile() || info.size > limit) throw new Error('Unavailable');
    return readFile(file);
  }
  async function posts() {
    const document = JSON.parse(
      (await privateFile('posts.json', 1024 * 1024)).toString('utf8'),
    );
    if (!Array.isArray(document.posts) || document.posts.length > 500)
      throw new Error('Invalid posts');
    return document.posts.map((post) => {
      if (
        typeof post.id !== 'string' ||
        typeof post.title !== 'string' ||
        typeof post.body !== 'string' ||
        typeof post.publishedAt !== 'string' ||
        !Array.isArray(post.assets)
      )
        throw new Error('Invalid post');
      return {
        id: post.id,
        title: post.title,
        body: post.body,
        publishedAt: post.publishedAt,
        assets: post.assets.map((asset) => {
          if (
            !assetPattern.test(asset.name) ||
            !mimeTypes[extname(asset.name).toLowerCase()] ||
            typeof asset.alt !== 'string'
          )
            throw new Error('Invalid asset');
          return {
            name: asset.name,
            alt: asset.alt,
            url: `/api/member/assets/${encodeURIComponent(asset.name)}`,
          };
        }),
      };
    });
  }
  function registerRoutes(app) {
    const opts = (max) => ({
      config: { rateLimit: { max, timeWindow: '1 minute' } },
    });
    app.post('/api/member/login/request', opts(5), async (request, reply) => {
      if (!allowed(request, reply)) return;
      const email =
        typeof request.body?.email === 'string'
          ? request.body.email.trim().toLowerCase()
          : '';
      if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
        return generic;
      const now = clock();
      const emailHash = hash(`${mode}:${email}`);
      const token = opaque();
      const browserNonce = sessionToken(request, browserCookieName) || opaque();
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db
          .prepare('SELECT requested_at FROM member_email_limits WHERE hash=?')
          .get(emailHash);
        if (prior && now - prior.requested_at < 60000) {
          db.exec('ROLLBACK');
          return generic;
        }
        db.prepare('DELETE FROM member_email_limits WHERE requested_at<?').run(
          now - 86400000,
        );
        db.prepare('DELETE FROM member_login_tokens WHERE expires_at<=?').run(
          now,
        );
        db.prepare('DELETE FROM member_sessions WHERE expires_at<=?').run(now);
        db.prepare(
          'INSERT OR REPLACE INTO member_email_limits VALUES (?,?)',
        ).run(emailHash, now);
        db.prepare(
          'INSERT INTO member_login_tokens (hash,mode,email,expires_at,browser_hash) VALUES (?,?,?,?,?)',
        ).run(hash(token), mode, email, now + 900000, hash(browserNonce));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      reply.header(
        'Set-Cookie',
        `${browserCookieName}=${browserNonce}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=900`,
      );
      const locale = request.body?.locale === 'en' ? 'en' : 'ja';
      const url = `${origin}${locale === 'en' ? '/en' : ''}/fanclub/#login=${token}`;
      try {
        await mailer({ email, url, locale });
      } catch {
        db.prepare('DELETE FROM member_login_tokens WHERE hash=?').run(
          hash(token),
        );
        app.log.warn({ event: 'member_login_delivery_failed' });
      }
      return generic;
    });
    app.post('/api/member/login/redeem', opts(10), async (request, reply) => {
      if (!allowed(request, reply)) return;
      const token = request.body?.token;
      const browserNonce = sessionToken(request, browserCookieName);
      if (
        !browserNonce ||
        typeof token !== 'string' ||
        !tokenPattern.test(token)
      )
        return reply.code(400).send({
          error:
            'Request a fresh sign-in link and open it in this same browser.',
        });
      let session;
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            'SELECT email FROM member_login_tokens WHERE hash=? AND mode=? AND expires_at>? AND browser_hash=?',
          )
          .get(hash(token), mode, clock(), hash(browserNonce));
        if (!row) {
          db.exec('ROLLBACK');
          return reply.code(400).send({
            error:
              'Request a fresh sign-in link and open it in this same browser.',
          });
        }
        db.prepare('DELETE FROM member_login_tokens WHERE hash=?').run(
          hash(token),
        );
        db.prepare(
          'INSERT OR IGNORE INTO member_accounts VALUES (?,?,?,?)',
        ).run(randomUUID(), mode, row.email, clock());
        const account = db
          .prepare('SELECT id FROM member_accounts WHERE mode=? AND email=?')
          .get(mode, row.email);
        // A fresh email verification also recovers the account by revoking older sessions and links.
        db.prepare('DELETE FROM member_sessions WHERE account_id=?').run(
          account.id,
        );
        db.prepare(
          'DELETE FROM member_login_tokens WHERE mode=? AND email=?',
        ).run(mode, row.email);
        session = opaque();
        db.prepare('INSERT INTO member_sessions VALUES (?,?,?,?)').run(
          hash(session),
          mode,
          account.id,
          clock() + sessionMs,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      reply.header(
        'Set-Cookie',
        `${cookieName}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionMs / 1000}`,
      );
      return generic;
    });
    app.post('/api/member/logout', opts(20), async (request, reply) => {
      if (!allowed(request, reply)) return;
      const token = sessionToken(request);
      if (token)
        db.prepare('DELETE FROM member_sessions WHERE hash=? AND mode=?').run(
          hash(token),
          mode,
        );
      reply.header(
        'Set-Cookie',
        `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      );
      return generic;
    });
    app.get('/api/member/session', opts(60), async (request, reply) => {
      if (!allowed(request, reply)) return;
      const account = accountForRequest(request);
      if (!account) return { authenticated: false, member: false };
      try {
        const membership = await membershipForAccount(account.id);
        return {
          authenticated: true,
          member: membership?.entitled === true,
          email: account.email,
        };
      } catch {
        return reply
          .code(503)
          .send({ error: 'Membership could not be verified.' });
      }
    });
    app.get('/api/member/posts', opts(60), async (request, reply) => {
      if (!(await requireMember(request, reply))) return;
      if (!config.memberContentDirectory) return { posts: [] };
      try {
        return { posts: await posts() };
      } catch {
        return reply
          .code(503)
          .send({ error: 'Member content is unavailable.' });
      }
    });
    app.get('/api/member/assets/:asset', opts(120), async (request, reply) => {
      if (!(await requireMember(request, reply))) return;
      const name = request.params.asset;
      try {
        if (
          !assetPattern.test(name) ||
          !mimeTypes[extname(name).toLowerCase()] ||
          !(await posts()).some((post) =>
            post.assets.some((asset) => asset.name === name),
          )
        )
          throw new Error('Unavailable');
        const data = await privateFile(name, 20 * 1024 * 1024);
        return reply
          .type(mimeTypes[extname(name).toLowerCase()])
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          .send(data);
      } catch {
        return reply.code(404).send({ error: 'Not found.' });
      }
    });
  }
  return {
    enabled,
    registerRoutes,
    requireAccount,
    requireMember,
    accountForRequest,
  };
}
