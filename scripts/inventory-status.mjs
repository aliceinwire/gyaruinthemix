import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const scopes = new Set(['test:sandbox', 'test:public', 'live:public']);
const usage =
  'Usage: node scripts/inventory-status.mjs --db PATH --scope test:sandbox|test:public|live:public [--json]';

export function inventoryStatus({ db, scope, products = [] }) {
  if (!scopes.has(scope)) throw new Error('Invalid inventory scope');
  if (!db.prepare('SELECT config FROM inventory_settings WHERE id=1').get())
    throw new Error('Inventory is not initialized');
  // One read statement gives a consistent snapshot while checkout is running.
  const rows = db
    .prepare(
      `SELECT s.sku, s.total,
        COALESCE(SUM(CASE WHEN a.state='settled' THEN l.quantity ELSE 0 END),0) AS sold,
        COALESCE(SUM(CASE WHEN a.state IN ('reserved','pending','review') THEN l.quantity ELSE 0 END),0) AS held,
        COALESCE(SUM(CASE WHEN a.state='review' THEN l.quantity ELSE 0 END),0) AS review
      FROM inventory_stock s
      LEFT JOIN inventory_lines l ON l.scope=s.scope AND l.sku=s.sku
      LEFT JOIN inventory_attempts a ON a.id=l.attempt
      WHERE s.scope=? GROUP BY s.sku, s.total ORDER BY s.sku`,
    )
    .all(scope);
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  const names = new Map(
    products.map((product) => [product.slug, product.name]),
  );
  const skus = new Set([...names.keys(), ...bySku.keys()]);
  return {
    scope,
    products: [...skus].map((sku) => {
      const row = bySku.get(sku);
      if (!row)
        return {
          sku,
          name: names.get(sku) || sku,
          total: null,
          sold: null,
          held: null,
          review: null,
          available: null,
        };
      const available = row.total - row.sold - row.held;
      if (!Number.isSafeInteger(available) || available < 0)
        throw new Error('Inventory totals need reconciliation');
      return { ...row, name: names.get(sku) || sku, available };
    }),
  };
}

export function parseStatusArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--json' && !parsed.json) {
      parsed.json = true;
      continue;
    }
    const name = { '--db': 'file', '--scope': 'scope' }[flag];
    const value = args[++i];
    if (!name || parsed[name] || !value || value.startsWith('--'))
      throw new Error(usage);
    parsed[name] = value;
  }
  if (!parsed.file || !scopes.has(parsed.scope)) throw new Error(usage);
  return parsed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let db;
  try {
    const { file, scope, json } = parseStatusArgs(process.argv.slice(2));
    // Never create a new ledger or change inventory while inspecting it.
    db = new DatabaseSync(file, { readOnly: true });
    const products = JSON.parse(
      readFileSync(new URL('../config/products.json', import.meta.url), 'utf8'),
    );
    const report = inventoryStatus({ db, scope, products });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`在庫区分: ${scope}`);
      console.table(
        report.products.map((product) => ({
          SKU: product.sku,
          商品: product.name,
          登録総数: product.total ?? '未設定',
          販売済み: product.sold ?? '未設定',
          確保中: product.held ?? '未設定',
          残数: product.available ?? '未設定',
          要確認: product.review ?? '未設定',
        })),
      );
      console.log(
        '残数 = 登録総数 − 販売済み − 確保中。要確認は確保中の内数です。',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
