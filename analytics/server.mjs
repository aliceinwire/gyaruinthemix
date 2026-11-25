import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openAnalytics } from './store.mjs';
import { lookup } from 'node:dns/promises';

const publicDirectory = new URL('./public/', import.meta.url);
const assets = new Map([
  ['/analytics/', ['index.html', 'text/html; charset=utf-8']],
  ['/analytics/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  [
    '/analytics/dashboard.mjs',
    ['dashboard.mjs', 'application/javascript; charset=utf-8'],
  ],
]);
const digest = (value) => createHash('sha256').update(value).digest();
export const passwordHash = (value) => digest(value).toString('hex');

export function createDashboardServer({
  store,
  credential,
  healthy = () => true,
}) {
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error('Invalid credential');
  const expected = Buffer.from(credential, 'hex');
  const files = new Map(
    [...assets].map(([path, [filename, type]]) => [
      path,
      { type, body: readFileSync(new URL(filename, publicDirectory)) },
    ]),
  );
  return createServer(
    { maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 10_000 },
    (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      );
      const auth = request.headers.authorization || '';
      const decoded =
        auth.startsWith('Basic ') && auth.length < 1024
          ? Buffer.from(auth.slice(6), 'base64').toString('utf8')
          : '';
      const authorized =
        decoded.startsWith('admin:') &&
        timingSafeEqual(digest(decoded.slice(6)), expected);
      if (!authorized) {
        response.writeHead(401, {
          'WWW-Authenticate':
            'Basic realm="GYARUINTHEMIX analytics", charset="UTF-8"',
        });
        response.end('Sign in to view analytics.');
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
      }
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/analytics/data.json') {
          const period = url.searchParams.get('days') || '7';
          if (!['7', '30', '90'].includes(period)) {
            response.writeHead(400);
            response.end('Invalid period');
            return;
          }
          if (!healthy()) throw new Error('Collection unavailable');
          const data = JSON.stringify(store.report(Number(period)));
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(request.method === 'HEAD' ? undefined : data);
          return;
        }
        const asset = files.get(url.pathname);
        if (!asset) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': asset.type });
        response.end(request.method === 'HEAD' ? undefined : asset.body);
      } catch {
        response.writeHead(503);
        response.end('Analytics are temporarily unavailable.');
      }
    },
  );
}

export async function startAnalytics({
  directory = '/var/lib/analytics',
  httpPort = 3002,
  udpPort = 3003,
  proxyHost = process.env.ANALYTICS_PROXY_HOST || 'proxy',
} = {}) {
  process.umask(0o077);
  const credentialFile = join(directory, 'password.sha256');
  const stat = statSync(credentialFile);
  if (!stat.isFile() || stat.size > 128 || stat.mode & 0o077)
    throw new Error('Invalid credential file');
  const credential = readFileSync(credentialFile, 'utf8').trim();
  // Resolve only the selected proxy service, never trust all private networks.
  let trusted = new Set();
  const resolveProxy = async () => {
    try {
      trusted = new Set(
        (await lookup(proxyHost, { all: true })).map((entry) => entry.address),
      );
    } catch {
      trusted = new Set();
    }
  };
  await resolveProxy();
  const dnsTimer = setInterval(resolveProxy, 60_000).unref();
  const store = openAnalytics(directory, { trustedProxies: () => trusted });
  let collectionFailed = false;
  const retentionTimer = setInterval(() => {
    try {
      store.prune();
    } catch {
      collectionFailed = true;
    }
  }, 3_600_000).unref();
  const server = createDashboardServer({
    store,
    credential,
    healthy: () => !collectionFailed,
  });
  const socket = createSocket('udp4');
  socket.on('message', (message, remote) => {
    if (remote.address !== '127.0.0.1') return;
    try {
      if (store.record(message)) collectionFailed = false;
    } catch {
      collectionFailed = true;
      process.stderr.write('Analytics count could not be saved.\n');
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(udpPort, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(httpPort, '127.0.0.1', resolve);
  });
  const close = async () => {
    clearInterval(dnsTimer);
    clearInterval(retentionTimer);
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => socket.close(resolve)),
    ]);
    store.close();
  };
  return {
    close,
    httpPort: server.address().port,
    udpPort: socket.address().port,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { close } = await startAnalytics();
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        await close();
        process.exit(0);
      });
  } catch {
    process.stderr.write(
      'Analytics could not start. Check its state volume and password file.\n',
    );
    process.exit(1);
  }
}
