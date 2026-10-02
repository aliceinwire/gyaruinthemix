import Stripe from 'stripe';
import { readConfig } from './config.mjs';
import { openJournal } from './journal.mjs';
import { buildApp } from './app.mjs';

let app;
try {
  const config = readConfig();
  const stripe = new Stripe(config.secretKey, {
    timeout: 8000,
    maxNetworkRetries: 1,
  });
  const journal = await openJournal(config.stateDir);
  app = await buildApp({
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
  await app.validateCatalog();
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
  process.exit(1);
}
