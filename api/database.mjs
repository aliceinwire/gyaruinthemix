import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// Keep this local disk volume with the service. SQLite serializes reservations
// across processes; synchronous FULL commits survive restarts before Checkout.
export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'commerce.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
  );
  if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') {
    db.close();
    throw new Error('Commerce database needs recovery');
  }
  return db;
}
