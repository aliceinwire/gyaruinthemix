import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAnalytics, passwordHash } from '../analytics/server.mjs';

test(
  'nginx collects real page responses and protects the dashboard end to end',
  { skip: !process.env.ANALYTICS_NGINX_BIN },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'gyaru-nginx-'));
    const state = join(directory, 'state');
    const root = join(directory, 'html');
    await mkdir(state);
    await mkdir(root);
    await writeFile(
      join(state, 'password.sha256'),
      passwordHash('local-nginx-fixture'),
      { mode: 0o600 },
    );
    const analytics = await startAnalytics({
      directory: state,
      httpPort: 0,
      udpPort: 0,
      proxyHost: 'localhost',
    });
    const reserve = createServer();
    await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    for (const path of ['', '/music', '/en/music', '/game']) {
      await mkdir(root + path, { recursive: true });
      await writeFile(
        root + path + '/index.html',
        '<!doctype html><title>Fixture</title>',
      );
    }
    await writeFile(root + '/asset.js', '/* fixture */');
    const proxy = (
      await readFile(
        new URL('../deploy/analytics-proxy.conf', import.meta.url),
        'utf8',
      )
    )
      .replace('127.0.0.1:3002', `127.0.0.1:${analytics.httpPort}`)
      .replace(
        '/etc/nginx/security-headers.conf',
        join(directory, 'security.conf'),
      );
    await writeFile(
      join(directory, 'security.conf'),
      await readFile(
        new URL('../deploy/security-headers.conf', import.meta.url),
      ),
    );
    await writeFile(
      join(directory, 'maps.conf'),
      await readFile(new URL('../deploy/analytics-maps.conf', import.meta.url)),
    );
    const config = `daemon off; master_process off; pid ${directory}/nginx.pid;
    error_log ${directory}/error.log warn;
    events { worker_connections 64; }
    http {
      include ${directory}/maps.conf;
      access_log syslog:server=127.0.0.1:${analytics.udpPort},tag=analytics,nohostname analytics if=$analytics_count;
      client_body_temp_path ${directory}/body;
      proxy_temp_path ${directory}/proxy;
      fastcgi_temp_path ${directory}/fastcgi;
      uwsgi_temp_path ${directory}/uwsgi;
      scgi_temp_path ${directory}/scgi;
      server { listen 127.0.0.1:${port}; root ${root}; index index.html;
        ${proxy}
        location / { try_files $uri $uri/ =404; }
      }
    }`;
    const filename = join(directory, 'nginx.conf');
    await writeFile(filename, config);
    execFileSync(
      process.env.ANALYTICS_NGINX_BIN,
      ['-t', '-p', directory, '-c', filename],
      { stdio: 'pipe' },
    );
    const processNginx = spawn(
      process.env.ANALYTICS_NGINX_BIN,
      ['-p', directory, '-c', filename],
      { stdio: 'ignore' },
    );
    t.after(async () => {
      processNginx.kill('SIGTERM');
      await new Promise((resolve) =>
        processNginx.exitCode !== null
          ? resolve()
          : processNginx.once('exit', resolve),
      );
      await analytics.close();
      await rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone) Safari/605.1',
      'X-Real-IP': '203.0.113.5',
      Referer: 'https://l.instagram.com/private?secret=hidden',
    };
    for (let i = 0; i < 40; i++) {
      try {
        const ready = await fetch(base + '/asset.js');
        await ready.text();
        break;
      } catch {
        if (i === 39) throw new Error('nginx did not start');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    for (const path of ['/?token=private', '/music/', '/en/music/', '/game/']) {
      const response = await fetch(base + path, { headers });
      assert.equal(response.status, 200);
      await response.text();
    }
    for (const [path, extra] of [
      ['/asset.js', {}],
      ['/music/', { 'User-Agent': 'Googlebot' }],
      ['/shop/success/?session_id=private', {}],
    ]) {
      const response = await fetch(base + path, {
        headers: { ...headers, ...extra },
      });
      await response.text();
    }
    const unavailable = await fetch(base + '/contact/', { headers });
    assert.equal(unavailable.status, 404);
    await unavailable.text();
    const denied = await fetch(base + '/analytics/data.json', { headers });
    assert.equal(denied.status, 401);
    await denied.text();
    const authentication = {
      Authorization:
        'Basic ' + Buffer.from('admin:local-nginx-fixture').toString('base64'),
    };
    const response = await fetch(base + '/analytics/data.json', {
      headers: authentication,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const data = await response.json();
    assert.equal(data.views, 4);
    assert.equal(data.visitors, 1);
    assert.equal(data.errors, 1);
    assert.deepEqual(data.sources, [{ name: 'instagram', count: 4 }]);
    assert.deepEqual(data.devices, [{ name: 'mobile', count: 4 }]);
    assert.deepEqual(
      new Set(data.pages.map((row) => row.name)),
      new Set(['/', '/music/', '/en/music/', '/game/']),
    );
    assert.ok(!JSON.stringify(data).includes('private'));
  },
);
