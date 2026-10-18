import { createHash } from 'node:crypto';

const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const scopes = new Set(['test:sandbox', 'test:public', 'live:public']);
const digest = (value) => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const encode = (value) => JSON.stringify(canonical(value));
function fail(code) {
  throw Object.assign(new Error(code), { code });
}

// The caller owns the DatabaseSync connection and its durable directory. No
// transaction spans a Stripe request. Stripe's key is the cross-process create
// lock; SQLite's immediate transactions are the cross-process reservation lock.
export function createInventory({ db, stripe, stock = {}, now = Date.now }) {
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS inventory_settings (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_stock (scope TEXT NOT NULL, sku TEXT NOT NULL, total INTEGER NOT NULL CHECK(total >= 0), PRIMARY KEY(scope,sku));
    CREATE TABLE IF NOT EXISTS inventory_attempts (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, request TEXT NOT NULL, params TEXT NOT NULL,
      stripe_key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, session_id TEXT UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('reserved','pending','settled','released','review')));
    CREATE TABLE IF NOT EXISTS inventory_lines (
      attempt TEXT NOT NULL REFERENCES inventory_attempts(id), scope TEXT NOT NULL, sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(attempt,sku));
    CREATE INDEX IF NOT EXISTS inventory_lines_stock ON inventory_lines(scope,sku);
    CREATE TABLE IF NOT EXISTS inventory_audit (id INTEGER PRIMARY KEY, attempt TEXT NOT NULL, at INTEGER NOT NULL, transition TEXT NOT NULL);`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  for (const [scope, products] of Object.entries(stock)) {
    if (
      !scopes.has(scope) ||
      !products ||
      typeof products !== 'object' ||
      Array.isArray(products)
    )
      fail('INVALID_STOCK_CONFIG');
    for (const [sku, total] of Object.entries(products))
      if (
        !/^[a-z0-9-]{1,40}$/.test(sku) ||
        !Number.isSafeInteger(total) ||
        total < 0
      )
        fail('INVALID_STOCK_CONFIG');
  }
  transaction(() => {
    const saved = db
      .prepare('SELECT config FROM inventory_settings WHERE id=1')
      .get();
    const config = encode(stock);
    // Config is a bootstrap manifest, never a restock operation. Explicit
    // operator reconciliation is required to change it after initialization.
    if (saved && saved.config !== config) fail('STOCK_CONFIG_MISMATCH');
    if (!saved) {
      db.prepare('INSERT INTO inventory_settings VALUES(1,?)').run(config);
      for (const [scope, products] of Object.entries(stock))
        for (const [sku, total] of Object.entries(products))
          db.prepare('INSERT INTO inventory_stock VALUES(?,?,?)').run(
            scope,
            sku,
            total,
          );
    }
  });
  const getAttempt = (id) =>
    db.prepare('SELECT * FROM inventory_attempts WHERE id=?').get(id);
  function remaining(scope, sku) {
    const row = db
      .prepare(
        `SELECT s.total - COALESCE((SELECT SUM(l.quantity) FROM inventory_lines l
      JOIN inventory_attempts a ON a.id=l.attempt WHERE l.scope=s.scope AND l.sku=s.sku AND a.state!='released'),0) AS remaining
      FROM inventory_stock s WHERE s.scope=? AND s.sku=?`,
      )
      .get(scope, sku);
    return row ? Math.max(0, row.remaining) : null;
  }
  function transition(id, state) {
    db.prepare('UPDATE inventory_attempts SET state=? WHERE id=?').run(
      state,
      id,
    );
    db.prepare(
      'INSERT INTO inventory_audit(attempt,at,transition) VALUES(?,?,?)',
    ).run(id, now(), state);
  }
  function verify(session, attempt) {
    if (
      !session ||
      !/^cs_[A-Za-z0-9_]+$/.test(session.id || '') ||
      (attempt.session_id && attempt.session_id !== session.id) ||
      session.livemode !== attempt.scope.startsWith('live:') ||
      session.mode !== 'payment' ||
      session.metadata?.inventory_attempt !== attempt.id ||
      session.metadata?.inventory_scope !== attempt.scope
    )
      fail('UNVERIFIED_SESSION');
  }
  function apply(session, id) {
    return transaction(() => {
      const attempt = getAttempt(id);
      verify(session, attempt);
      if (!attempt.session_id)
        db.prepare('UPDATE inventory_attempts SET session_id=? WHERE id=?').run(
          session.id,
          id,
        );
      let state = attempt.state;
      if (session.status === 'complete' && session.payment_status === 'paid') {
        if (state === 'released') fail('RECONCILIATION_REQUIRED');
        state = 'settled';
      } else if (
        session.status === 'expired' &&
        session.payment_status === 'unpaid'
      ) {
        if (state !== 'settled') state = 'released';
      } else if (
        session.status === 'complete' &&
        session.payment_status === 'unpaid'
      ) {
        if (!['settled', 'released'].includes(state)) state = 'pending';
      } else if (
        !(session.status === 'open' && session.payment_status === 'unpaid')
      ) {
        fail('UNVERIFIED_SESSION');
      }
      if (state !== attempt.state) transition(id, state);
      return session;
    });
  }
  async function refresh(id) {
    const attempt = getAttempt(id);
    return apply(
      await stripe.checkout.sessions.retrieve(attempt.session_id),
      id,
    );
  }
  async function resume(id) {
    const attempt = getAttempt(id);
    if (attempt.session_id) return refresh(id);
    if (
      attempt.state === 'review' ||
      now() - attempt.created >= RETRY_WINDOW_MS ||
      now() < attempt.created
    ) {
      transaction(() => {
        if (getAttempt(id).state !== 'review') transition(id, 'review');
      });
      fail('RECONCILIATION_REQUIRED');
    }
    // Any create error is ambiguous, including network timeout and 5xx. Keep
    // the reservation and exact params/key for retry, never release here.
    const session = await stripe.checkout.sessions.create(
      JSON.parse(attempt.params),
      { idempotencyKey: attempt.stripe_key },
    );
    verify(session, attempt);
    transaction(() => {
      const current = getAttempt(id);
      verify(session, current);
      if (!current.session_id)
        db.prepare('UPDATE inventory_attempts SET session_id=? WHERE id=?').run(
          session.id,
          id,
        );
    });
    // Idempotent creates can return a cached open response after payment/expiry.
    return refresh(id);
  }
  return {
    db,
    healthy() {
      try {
        db.prepare('SELECT 1').get();
        return true;
      } catch {
        return false;
      }
    },
    decorateCatalog(scope, catalog) {
      if (!scopes.has(scope)) fail('INVALID_SCOPE');
      return {
        ...catalog,
        products: catalog.products.map((product) => {
          const availableStock = remaining(scope, product.slug);
          return {
            ...product,
            availableStock,
            maxQuantity:
              availableStock === null
                ? product.maxQuantity
                : Math.min(product.maxQuantity, availableStock),
            availability:
              product.availability === 'available' &&
              (availableStock === null || availableStock === 0)
                ? 'sold_out'
                : product.availability,
          };
        }),
      };
    },
    async checkout({ scope, attemptId, items, params }) {
      if (
        !scopes.has(scope) ||
        typeof attemptId !== 'string' ||
        attemptId.length < 1 ||
        attemptId.length > 255
      )
        fail('INVALID_ATTEMPT');
      if (!Array.isArray(items) || items.length === 0 || items.length > 20)
        fail('INVALID_ITEMS');
      const lines = items
        .map(({ product, quantity }) => {
          if (
            !/^[a-z0-9-]{1,40}$/.test(product || '') ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            quantity > 20
          )
            fail('INVALID_ITEMS');
          return { product, quantity };
        })
        .sort((a, b) => a.product.localeCompare(b.product));
      if (
        new Set(lines.map((line) => line.product)).size !== lines.length ||
        lines.reduce((sum, line) => sum + line.quantity, 0) > 20
      )
        fail('INVALID_ITEMS');
      const id = digest(`${scope}:${attemptId.toLowerCase()}`);
      const request = encode({ lines, params });
      transaction(() => {
        const previous = getAttempt(id);
        if (previous) {
          if (previous.request !== request) fail('ATTEMPT_CONFLICT');
          return;
        }
        for (const line of lines) {
          const available = remaining(scope, line.product);
          if (available === null) fail('INVENTORY_UNAVAILABLE');
          if (available < line.quantity) fail('INSUFFICIENT_STOCK');
        }
        const savedParams = {
          ...params,
          metadata: {
            ...params.metadata,
            inventory_attempt: id,
            inventory_scope: scope,
          },
        };
        db.prepare(
          'INSERT INTO inventory_attempts(id,scope,request,params,stripe_key,created,state) VALUES(?,?,?,?,?,?,?)',
        ).run(
          id,
          scope,
          request,
          encode(savedParams),
          `gyaru-stock-v1-${id}`,
          now(),
          'reserved',
        );
        for (const line of lines)
          db.prepare('INSERT INTO inventory_lines VALUES(?,?,?,?)').run(
            id,
            scope,
            line.product,
            line.quantity,
          );
        db.prepare(
          'INSERT INTO inventory_audit(attempt,at,transition) VALUES(?,?,?)',
        ).run(id, now(), 'reserved');
      });
      return resume(id);
    },
    async handleWebhook(event) {
      const session = event?.data?.object;
      // Webhook payload state is never authoritative, including duplicates and
      // out-of-order events. Only signed-event routing occurs in the caller.
      if (!session?.id) return false;
      let attempt = db
        .prepare('SELECT * FROM inventory_attempts WHERE session_id=?')
        .get(session.id);
      if (!attempt && session.metadata?.inventory_attempt)
        attempt = getAttempt(session.metadata.inventory_attempt);
      if (!attempt) return false;
      const current = await stripe.checkout.sessions.retrieve(session.id);
      apply(current, attempt.id);
      return true;
    },
    async reconcile() {
      const attempts = db
        .prepare(
          "SELECT id FROM inventory_attempts WHERE state IN ('reserved','pending','review') ORDER BY created",
        )
        .all();
      const result = { checked: 0, failed: 0, review: 0 };
      for (const attempt of attempts) {
        try {
          await resume(attempt.id);
          result.checked++;
        } catch (error) {
          if (error.code === 'RECONCILIATION_REQUIRED') result.review++;
          else result.failed++;
        }
      }
      return result;
    },
  };
}
