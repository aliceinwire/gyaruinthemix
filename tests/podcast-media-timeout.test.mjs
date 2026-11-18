import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const command of ['convert', 'mpg123-strip']) {
  test(`${command} cannot hold the podcast scanner indefinitely`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'podcast-timeout-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const bin = join(directory, 'bin');
    const media = join(directory, 'media');
    await mkdir(bin);
    await mkdir(media);
    await writeFile(
      join(bin, command),
      '#!/bin/sh\ntrap "" TERM\nexec sleep 30\n',
      { mode: 0o755 },
    );
    const module = new URL('../scripts/podcast-media.mjs', import.meta.url)
      .href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const execute = childProcess.execFileSync;
      childProcess.execFileSync = (file, args, options) => {
        assert.equal(file, ${JSON.stringify(command)});
        assert.equal(options.timeout, 120_000);
        assert.equal(options.killSignal, 'SIGKILL');
        return execute(file, args, { ...options, timeout: 100 });
      };
      syncBuiltinESMExports();
      const { preparePodcastMedia } = await import(${JSON.stringify(module)});
      await assert.rejects(preparePodcastMedia(
        ${JSON.stringify(media)}, 'output.mp3', 0,
        { date: '2026-11-18', title: 'Episode', tags: [] },
        ${command === 'convert' ? '{ picture: [{ data: Buffer.from([255, 216, 255]) }] }' : '{}'}
      ), { code: 'ETIMEDOUT' });
    `,
      ],
      {
        env: { ...process.env, PATH: bin + ':' + process.env.PATH },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(await readdir(media), []);
  });
}
