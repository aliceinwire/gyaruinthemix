import Stripe from 'stripe';
import { readConfig } from './config.mjs';
import { openJournal } from './journal.mjs';
import { buildApp } from './app.mjs';
import { openDatabase } from './database.mjs';
import { createInventory } from './inventory.mjs';
import { createMembership } from './membership.mjs';
import { createMemberAccess } from './member-access.mjs';

let app;
let db;
try {
  const config = readConfig();
  const stripe = new Stripe(config.secretKey, {
    timeout: 8000,
    maxNetworkRetries: 1,
  });
  const journal = await openJournal(config.stateDir);
  db = openDatabase(config.stateDir);
  const inventory = createInventory({ db, stripe, stock: config.inventory });
  const membership = createMembership({ db, stripe, config });
  const memberAccess = createMemberAccess({
    db,
    config,
    membershipForAccount: (id) => membership.entitlement(id),
  });
  app = await buildApp({
    inventory,
    membership,
    memberAccess,
    config,
    stripe,
    journal,
    logger: {
      level: 'info',
      redact: [
        'req.headers',
        'body',
        'err',
        'config',
        'secretKey',
        'webhookSecret',
      ],
    },
  });
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      const report = await inventory.reconcile();
      if (report.failed || report.review)
        app.log.warn({ event: 'inventory_reconciliation_required', ...report });
    } catch {
      app.log.warn({ event: 'inventory_reconciliation_required' });
    } finally {
      reconciling = false;
    }
  };
  const timer = setInterval(reconcile, 60_000).unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    // Fastify drains requests before this hook. Stop scheduling new DB work;
    // process exit closes SQLite after outstanding reconciliation has ended.
  });
  await app.validateCatalog();
  await reconcile();
  await app.listen({ port: config.port, host: config.host });
  app.log.info({
    event: 'service_ready',
    mode: config.mode,
    salesEnabled: config.salesEnabled,
  });
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, async () => {
      const timer = setTimeout(() => process.exit(1), 15_000).unref();
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    });
} catch {
  // Configuration and SDK errors may contain secrets or paths; never serialize them.
  process.stderr.write(
    '{"level":"error","event":"startup_failed","hint":"Check secret permissions, mode, catalog, shipping and journal using README."}\n',
  );
  if (app) await app.close();
  if (db) db.close();
  process.exit(1);
}
