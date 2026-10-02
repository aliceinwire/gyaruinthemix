import assert from 'node:assert/strict';
const base = process.argv[2];
if (
  !base ||
  new URL(base).protocol !== 'https:' ||
  new URL(base).origin !== base
)
  throw new Error('Usage: npm run smoke -- https://YOUR_DOMAIN');
async function check(path, options) {
  const response = await fetch(base + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    ...options,
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}
for (const path of [
  '/',
  '/shop/',
  '/about/',
  '/music/',
  '/live/',
  '/news/',
  '/fanclub/',
  '/shop/success/',
  '/shop/cancel/',
  '/legal/',
  '/privacy/',
]) {
  const response = await check(path);
  for (const header of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ])
    assert.ok(response.headers.has(header), `${path}: missing ${header}`);
  const html = await response.text();
  assert.ok(html.includes('ギャルインザミックス'));
  for (const match of html.matchAll(
    /(?:src|href)="(\/(?:assets|_astro)\/[^" ]+)"/g,
  ))
    await check(match[1]);
  console.log(`PASS ${path} + headers + linked assets`);
}
await check('/leopard.svg');
assert.equal((await (await check('/api/health')).json()).status, 'ok');
const catalog = await (await check('/api/catalog')).json();
assert.equal(
  catalog.mode,
  'test',
  'Run the launch smoke procedure in TEST mode first.',
);
const invalid = await fetch(base + '/api/stripe/webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': 'invalid',
  },
  body: '{}',
});
assert.equal(invalid.status, 400);
console.log(
  'PASS health, TEST mode, invalid webhook rejection. No payment was created.',
);
console.log(
  'NEXT: complete the manual TEST checkout/cancel/webhook/restart/ZNC checks in README.',
);
