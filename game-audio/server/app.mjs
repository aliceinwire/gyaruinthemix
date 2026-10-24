import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
const BASE = '/game-audio/v1',
  BRAND = 'ギャルインザミックス';
const TRACK = /^t-[a-f0-9]{24}$/,
  SID = /^[A-Za-z0-9_-]{32}$/,
  FILE = /^(init\.mp4|seg-\d{5}\.m4s)$/;
export async function loadCatalog(mediaRoot) {
  const root = await realpath(resolve(mediaRoot));
  const catalogPath = join(root, 'catalog.json');
  if ((await lstat(catalogPath)).isSymbolicLink())
    throw new Error('Catalog symlink rejected.');
  const raw = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.tracks) ||
    raw.tracks.length > 200
  )
    throw new Error('Invalid catalog.');
  const tracks = new Map();
  for (const t of raw.tracks) {
    if (
      !TRACK.test(t.id) ||
      tracks.has(t.id) ||
      !Number.isFinite(t.duration) ||
      t.duration <= 0 ||
      t.duration > 7201 ||
      !Array.isArray(t.chunks) ||
      !t.chunks.length ||
      t.chunks.length > 1802 ||
      t.init !== 'init.mp4'
    )
      throw new Error('Invalid track.');
    const directory = join(root, t.id);
    if (
      (await lstat(directory)).isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new Error('Track symlink rejected.');
    const files = new Map();
    for (const file of [t.init, ...t.chunks.map((c) => c.file)]) {
      if (!FILE.test(file) || files.has(file))
        throw new Error('Invalid media file.');
      const path = join(directory, file),
        stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size <= 0 ||
        stat.size > 256 * 1024 ||
        !(await realpath(path)).startsWith(root + sep)
      )
        throw new Error('Unsafe media file.');
      files.set(file, { path, size: stat.size });
    }
    if (
      t.chunks.some(
        (c) =>
          !Number.isFinite(c.duration) || c.duration <= 0 || c.duration > 4.1,
      )
    )
      throw new Error('Invalid chunk.');
    if (
      Math.abs(t.duration - t.chunks.reduce((n, c) => n + c.duration, 0)) > 0.01
    )
      throw new Error('Invalid duration.');
    const title =
      typeof t.title === 'string'
        ? t.title
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .trim()
            .slice(0, 160)
        : '';
    if (!title) continue;
    tracks.set(t.id, {
      ...t,
      title,
      files,
    });
  }
  return tracks;
}
export function createAudioHandler({
  tracks,
  key,
  origin,
  secureCookies = true,
  enabled = false,
  now = () => Date.now(),
  ttlSeconds = 120,
  maxSessionsPerMinute = 120,
  onError = () => {},
}) {
  if (enabled && (!Buffer.isBuffer(key) || key.length < 32))
    throw new Error('A separately provisioned signing key is required.');
  const site = new URL(origin);
  if (site.origin !== origin || (secureCookies && site.protocol !== 'https:'))
    throw new Error('Exact HTTPS origin required.');
  if (ttlSeconds < 15 || ttlSeconds > 300)
    throw new Error('Session lifetime out of bounds.');
  const cookieName = secureCookies
    ? '__Secure-gyaru_audio'
    : 'gyaru_audio_preview';
  const counters = new Map();
  let activeStreams = 0;
  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
  };
  const verify = (token, kind) => {
    if (typeof token !== 'string' || token.length > 1500) return null;
    const [body, signature, ...extra] = token.split('.');
    if (extra.length || !body || !signature) return null;
    const actual = Buffer.from(signature, 'base64url'),
      expected = createHmac('sha256', key).update(body).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    try {
      const v = JSON.parse(Buffer.from(body, 'base64url'));
      const t = Math.floor(now() / 1000);
      return v.v === 1 &&
        v.kind === kind &&
        TRACK.test(v.track) &&
        SID.test(v.sid) &&
        Number.isInteger(v.exp) &&
        v.exp > t &&
        v.exp <= t + ttlSeconds + 1
        ? v
        : null;
    } catch {
      return null;
    }
  };
  const limited = (id, limit, windowMs = 60000) => {
    const time = now(),
      entry = counters.get(id);
    if (!entry || entry.until <= time) {
      if (counters.size >= 4096) {
        for (const [k, v] of counters) if (v.until <= time) counters.delete(k);
        if (counters.size >= 4096) return true;
      }
      counters.set(id, { n: 1, until: time + windowMs });
      return false;
    }
    return ++entry.n > limit;
  };
  const headers = (res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  };
  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
  };
  const cookie = (req) => {
    const raw = req.headers.cookie || '';
    if (raw.length > 8192) return null;
    const values = raw
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(cookieName + '='));
    return values.length === 1
      ? verify(values[0].slice(cookieName.length + 1), 'session')
      : null;
  };
  const handler = async function handle(req, res) {
    if (!req.url?.startsWith('/game-audio/')) return false;
    headers(res);
    try {
      const url = new URL(req.url, origin),
        path = url.pathname;
      const foreignOrigin = req.headers.origin && req.headers.origin !== origin;
      const foreignFetch =
        req.headers['sec-fetch-site'] &&
        !['same-origin', 'none'].includes(req.headers['sec-fetch-site']);
      if (foreignOrigin || foreignFetch) {
        send(res, 403, { error: 'Forbidden' });
        return true;
      }
      if (path === `${BASE}/health` && req.method === 'GET') {
        send(res, 200, { ok: true });
        return true;
      }
      if (path === `${BASE}/config` && req.method === 'GET') {
        send(res, 200, { enabled: enabled === true });
        return true;
      }
      if (enabled !== true) {
        send(res, 404, { error: 'Unavailable' });
        return true;
      }
      if (path === `${BASE}/catalog` && req.method === 'GET') {
        send(res, 200, {
          brand: BRAND,
          tracks: [...tracks.values()].map((t) => ({
            id: t.id,
            title: t.title,
            duration: t.duration,
            excerpt: Boolean(t.excerpt),
          })),
        });
        return true;
      }
      if (path === `${BASE}/session` && req.method === 'POST') {
        if (
          req.headers.origin !== origin ||
          !String(req.headers['content-type'] || '').startsWith(
            'application/json',
          )
        ) {
          send(res, 403, { error: 'Forbidden' });
          return true;
        }
        if (limited('issue:global', maxSessionsPerMinute)) {
          res.setHeader('Retry-After', '60');
          send(res, 429, { error: 'Please retry later' });
          return true;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) {
            send(res, 413, { error: 'Request too large' });
            return true;
          }
        }
        let request;
        try {
          request = JSON.parse(body);
        } catch {
          send(res, 400, { error: 'Invalid request' });
          return true;
        }
        const t = tracks.get(request.trackId);
        if (!t) {
          send(res, 404, { error: 'Unavailable' });
          return true;
        }
        const previous = cookie(req),
          sid =
            previous?.track === t.id
              ? previous.sid
              : randomBytes(24).toString('base64url'),
          exp = Math.floor(now() / 1000) + ttlSeconds;
        const claims = { v: 1, kind: 'session', track: t.id, sid, exp };
        res.setHeader(
          'Set-Cookie',
          `${cookieName}=${sign(claims)}; Path=/game-audio/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`,
        );
        const ticket = sign({ ...claims, kind: 'manifest' });
        send(res, 200, {
          sessionId: sid,
          trackId: t.id,
          expiresAt: exp * 1000,
          renewAfterMs: Math.floor((ttlSeconds * 1000) / 3),
          manifestUrl: `${BASE}/stream/${t.id}/${sid}/index.m3u8?ticket=${ticket}`,
        });
        return true;
      }
      const match = path.match(
        /^\/game-audio\/v1\/stream\/(t-[a-f0-9]{24})\/([A-Za-z0-9_-]{32})\/(index\.m3u8|init\.mp4|seg-\d{5}\.m4s)$/,
      );
      if (!match || !['GET', 'HEAD'].includes(req.method)) {
        send(res, 404, { error: 'Unavailable' });
        return true;
      }
      const [, id, sid, name] = match,
        session = cookie(req),
        t = tracks.get(id);
      if (!session || session.track !== id || session.sid !== sid || !t) {
        send(res, 401, { error: 'Playback session required' });
        return true;
      }
      if (limited(`stream:${sid}`, 240)) {
        res.setHeader('Retry-After', '60');
        send(res, 429, { error: 'Please retry later' });
        return true;
      }
      if (name === 'index.m3u8') {
        const ticket = verify(url.searchParams.get('ticket'), 'manifest');
        if (!ticket || ticket.sid !== sid || ticket.track !== id) {
          send(res, 401, { error: 'Playback session required' });
          return true;
        }
        const prefix = `${BASE}/stream/${id}/${sid}/`;
        const manifest = [
          '#EXTM3U',
          '#EXT-X-VERSION:7',
          `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...t.chunks.map((c) => c.duration)))}`,
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-PLAYLIST-TYPE:VOD',
          `#EXT-X-MAP:URI="${prefix}${t.init}"`,
          ...t.chunks.flatMap((c) => [
            `#EXTINF:${c.duration.toFixed(6)},`,
            `${prefix}${c.file}`,
          ]),
          '#EXT-X-ENDLIST',
          '',
        ].join('\n');
        res.setHeader('Content-Length', Buffer.byteLength(manifest));
        send(
          res,
          200,
          req.method === 'HEAD' ? '' : manifest,
          'application/vnd.apple.mpegurl',
        );
        return true;
      }
      const file = t.files.get(name);
      if (!file) {
        send(res, 404, { error: 'Unavailable' });
        return true;
      }
      // Check again at use, so replacing an operator-managed package with a symlink fails closed.
      const stat = await lstat(file.path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== file.size ||
        (await realpath(file.path)) !== file.path
      ) {
        send(res, 404, { error: 'Unavailable' });
        return true;
      }
      let start = 0,
        end = file.size - 1,
        status = 200;
      if (req.headers.range) {
        const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!r || (!r[1] && !r[2])) {
          res.setHeader('Content-Range', `bytes */${file.size}`);
          send(res, 416, '');
          return true;
        }
        if (!r[1]) start = Math.max(0, file.size - Number(r[2]));
        else start = Number(r[1]);
        if (r[1] && r[2]) end = Math.min(end, Number(r[2]));
        if (
          start > end ||
          start >= file.size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          res.setHeader('Content-Range', `bytes */${file.size}`);
          send(res, 416, '');
          return true;
        }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      }
      if (activeStreams >= 32) {
        send(res, 503, { error: 'Please retry later' });
        return true;
      }
      res.writeHead(status, {
        'Content-Type': name === 'init.mp4' ? 'audio/mp4' : 'audio/iso.segment',
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
      });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      activeStreams++;
      try {
        await pipeline(createReadStream(file.path, { start, end }), res);
      } finally {
        activeStreams--;
      }
    } catch (e) {
      onError(e);
      if (!res.headersSent)
        send(res, 500, { error: 'Temporarily unavailable' });
      else res.destroy();
    }
    return true;
  };
  handler.replaceTracks = (next) => {
    if (!(next instanceof Map)) throw new Error('Validated catalog required.');
    tracks = next;
  };
  return handler;
}
