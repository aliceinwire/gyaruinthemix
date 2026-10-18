import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const scopes = new Set(['test:sandbox', 'test:public', 'live:public']);
const usage =
  'Usage: node scripts/inventory-stock.mjs --db PATH --scope test:sandbox|test:public|live:public --sku SKU (--add N | --set-total N) --ack-offline-backup';
function invalid(message) {
  throw new Error(message);
}

// Local operator-only action. Stop every API/worker using this database and
// take a consistent backup first. No HTTP route exposes this operation.
export function adjustStock({ db, scope, sku, add, setTotal, now = Date.now }) {
  if (!scopes.has(scope) || !/^[a-z0-9-]{1,40}$/.test(sku || ''))
    invalid('Invalid scope or SKU');
  if ((add === undefined) === (setTotal === undefined))
    invalid('Choose exactly one adjustment');
  const amount = add ?? setTotal;
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    (add !== undefined && add === 0)
  )
    invalid('Invalid stock count');
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
  try {
    // Requiring the original manifest also prevents edits to the wrong empty
    // SQLite file. It remains unchanged: subsequent config drift still fails.
    if (!db.prepare('SELECT config FROM inventory_settings WHERE id=1').get())
      invalid('Inventory is not initialized');
    const previous = db
      .prepare('SELECT total FROM inventory_stock WHERE scope=? AND sku=?')
      .get(scope, sku);
    const committed = db
      .prepare(
        `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM inventory_lines l
      JOIN inventory_attempts a ON a.id=l.attempt WHERE l.scope=? AND l.sku=? AND a.state!='released'`,
      )
      .get(scope, sku).quantity;
    const previousTotal = previous?.total ?? 0;
    const total = add === undefined ? setTotal : previousTotal + add;
    if (!Number.isSafeInteger(total)) invalid('Stock count exceeds safe range');
    if (total < committed)
      invalid('Total cannot be less than sold and held units');
    db.exec(`CREATE TABLE IF NOT EXISTS inventory_stock_audit (
      id INTEGER PRIMARY KEY, scope TEXT NOT NULL, sku TEXT NOT NULL, at INTEGER NOT NULL,
      operation TEXT NOT NULL, previous_total INTEGER NOT NULL, next_total INTEGER NOT NULL, committed INTEGER NOT NULL)`);
    db.prepare(
      `INSERT INTO inventory_stock(scope,sku,total) VALUES(?,?,?)
      ON CONFLICT(scope,sku) DO UPDATE SET total=excluded.total`,
    ).run(scope, sku, total);
    db.prepare(
      'INSERT INTO inventory_stock_audit(scope,sku,at,operation,previous_total,next_total,committed) VALUES(?,?,?,?,?,?,?)',
    ).run(
      scope,
      sku,
      now(),
      add === undefined ? 'set-total' : 'add',
      previousTotal,
      total,
      committed,
    );
    db.exec('COMMIT');
    return {
      scope,
      sku,
      previousTotal,
      total,
      committed,
      available: total - committed,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function parseStockArgs(args) {
  const parsed = {};
  const names = new Map([
    ['--db', 'file'],
    ['--scope', 'scope'],
    ['--sku', 'sku'],
    ['--add', 'add'],
    ['--set-total', 'setTotal'],
  ]);
  let acknowledged = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--ack-offline-backup' && !acknowledged) {
      acknowledged = true;
      continue;
    }
    const name = names.get(flag);
    const value = args[++i];
    if (!name || parsed[name] !== undefined || !value || value.startsWith('--'))
      invalid(usage);
    if (name === 'add' || name === 'setTotal') {
      if (!/^(0|[1-9][0-9]*)$/.test(value))
        invalid('Use a non-negative integer stock count');
      parsed[name] = Number(value);
    } else parsed[name] = value;
  }
  if (!acknowledged || !parsed.file || !parsed.scope || !parsed.sku)
    invalid(usage);
  return parsed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let db;
  try {
    const { file, ...adjustment } = parseStockArgs(process.argv.slice(2));
    if (!existsSync(file))
      invalid('Database does not exist; initialize the API database first');
    db = new DatabaseSync(file);
    console.log(JSON.stringify(adjustStock({ db, ...adjustment })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
