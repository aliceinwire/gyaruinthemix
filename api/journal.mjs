import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// One process only. Persist before logging: duplicates stay suppressed after restart.
// This is an observation journal, not an exactly-once fulfillment system.
export async function openJournal(directory, maxEntries = 100_000) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'webhook-events.ndjson');
  const seen = new Set();
  let entries = 0;
  try {
    if ((await stat(file)).size > 32 * 1024 * 1024)
      throw new Error('Journal capacity exceeded');
    const raw = await readFile(file, 'utf8');
    // A torn write fails closed instead of forgetting a processed observation.
    if (raw && !raw.endsWith('\n')) throw new Error('Journal needs recovery');
    for (const line of raw.split('\n').filter(Boolean)) {
      const row = JSON.parse(line);
      if (
        !Array.isArray(row.keys) ||
        row.keys.some((k) => typeof k !== 'string')
      )
        throw new Error('Invalid journal');
      row.keys.forEach((k) => seen.add(k));
      entries++;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entries >= maxEntries) throw new Error('Journal capacity exceeded');
  const handle = await open(file, 'a', 0o600);
  let queue = Promise.resolve();
  let healthy = true;
  return {
    healthy: () => healthy,
    claim(keys, blockers = []) {
      const task = queue.then(async () => {
        if (!healthy) throw new Error('Journal unavailable');
        if ([...keys, ...blockers].some((k) => seen.has(k))) return false;
        if (entries >= maxEntries) {
          healthy = false;
          throw new Error('Journal capacity exceeded');
        }
        try {
          await handle.writeFile(
            JSON.stringify({ keys, at: new Date().toISOString() }) + '\n',
          );
          await handle.sync();
          keys.forEach((k) => seen.add(k));
          entries++;
          return true;
        } catch {
          healthy = false;
          throw new Error('Journal unavailable');
        }
      });
      queue = task.catch(() => {});
      return task;
    },
    async close() {
      await queue;
      await handle.close();
    },
  };
}
