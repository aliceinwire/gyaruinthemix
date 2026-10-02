import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openJournal } from '../api/journal.mjs';

test('journal survives process restart and suppresses duplicates', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gyaru-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let journal = await openJournal(dir);
  assert.equal(await journal.claim(['event:one', 'session:paid']), true);
  await journal.close();
  journal = await openJournal(dir);
  assert.equal(await journal.claim(['event:one', 'session:paid']), false);
  assert.equal(await journal.claim(['event:two', 'session:paid']), false);
  await journal.close();
});
test('journal capacity and torn writes fail closed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gyaru-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = await openJournal(dir, 1);
  await journal.claim(['first']);
  await assert.rejects(journal.claim(['second']));
  assert.equal(journal.healthy(), false);
  await journal.close();
  await appendFile(join(dir, 'webhook-events.ndjson'), '{');
  await assert.rejects(openJournal(dir));
});
