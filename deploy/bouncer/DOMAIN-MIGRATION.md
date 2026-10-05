# Move the website to gyaruinthemix.com

The public canonical URL is **https://gyaruinthemix.com**. Astro, canonical/Open Graph metadata, `robots.txt` and the public sitemap use `src/data/urls.mjs` at build time. Hidden sandbox pages, checkout returns and the error page are `noindex` and absent from the sitemap. Metadata does not redirect requests or change the API's configured origin.

This is an operator-run migration in the existing `~/bouncer` project. A source/image update does **not** change DNS, the installed Compose file, `.env`, certificates or Stripe settings. If the image updater is active, coordinate the merge/release with this procedure: new images advertise the new canonical URL even while the old hostname still serves them. Do not change ZNC's `znc.alicef.me`, its certificate settings, contact email addresses, the shared proxy or Limnoria.

## 1. Prepare DNS and record the current configuration

- Confirm the website currently uses `gyaruinthemix.alicef.me` in `~/bouncer/.env`. Record the existing Compose project, image revisions, website configuration and Stripe sandbox endpoint URL for rollback. Preserve current secret files and the API journal; do not copy secrets into notes or commands.
- At the domain's authoritative DNS provider, point the apex (`@`) **A** record for `gyaruinthemix.com` at the VPS's actual public IPv4 from the Sakura control panel. **219.94.232.1 is a gateway, not a verified VPS address.** Keep the old domain's DNS. Only publish AAAA if this same service is reachable over the verified VPS IPv6; inspect CAA if issuance is restricted. No IP or DNS state is assumed by this repository.
- `www.gyaruinthemix.com` is not required or automatically configured. Once the apex is working and is the API's primary origin, follow the [optional www redirect guide](WWW-REDIRECT.md). The web image now redirects exactly that www hostname to the apex; DNS and its routing/certificate alias still require deliberate activation. Do not use www during old-origin staging, or remove any aliases still needed for a migration in progress. Canonical links alone are not HTTP redirects.
- Check both domains reach the existing proxy on ports 80/443 and that its certificate companion can validate both names. If an existing CDN/proxy is used, preserve its setup, valid origin TLS, and unchallenged/uncached `/api/*` delivery. Do not replace the shared proxy or bypass certificate warnings.
- Pause only the website updater scheduler, if enabled, and ensure an active run has finished before manual Compose operations. Follow the [scheduler pause instructions](README.md#3-activate-automatic-checks-once). Keep unrelated jobs running.

## 2. Stage the new hostname without changing the checkout origin

Review and install this release's `deploy/bouncer/docker-compose.yml` into `~/bouncer/docker-compose.yml`, reconciling local changes and preserving the existing project identity. Back up the installed configuration first; do not overwrite the whole `.env` from the example.

Set just these routing values in the existing `~/bouncer/.env`:

```dotenv
STORE_DOMAIN=gyaruinthemix.alicef.me
STORE_HOSTS=gyaruinthemix.alicef.me,gyaruinthemix.com
```

`STORE_DOMAIN` is always one bare hostname and defines the API's exact `SITE_URL`. Optional `STORE_HOSTS` is a comma-separated, no-spaces list for `VIRTUAL_HOST` and `LETSENCRYPT_HOST`; it must include `STORE_DOMAIN`. Blank/unset keeps the original single-host behavior. Keep the old hostname first while staging because the certificate companion uses the first SAN hostname as its base name. Verify support in the actually installed companion/proxy version.

Recreate only the website with the already reviewed/pulled image. This step installs aliases; it does not build or upgrade shared services:

```bash
cd ~/bouncer
docker compose config --quiet
docker compose up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 120 gyaruinthemix-web
curl --fail https://gyaruinthemix.alicef.me/web-health
curl --fail https://gyaruinthemix.com/web-health
```

Wait for valid HTTPS on **both** hosts and verify normal artist pages, assets and HTTP-to-HTTPS redirects. Never use `curl -k`. Stop and restore the previous routing settings/recreate web if the existing hostname regresses. Container health alone does not check external DNS/TLS.

The new hostname can now serve pages and receive signed webhooks. Browser checkout and sandbox session-status requests on the new hostname still return 403 because the API intentionally accepts only the old origin at this stage. Do not widen CORS or the origin allowlist to work around this. Do not open a checkout to test DNS or certificates.

## 3. Reconcile sandbox attempts before switching the API origin

Keep `STRIPE_MODE=test` and public `SALES_ENABLED=false`. Keep the existing checkout mode, image family, Price/shipping IDs, restricted test key, `STORE_DETAILS_REVIEWED` and `LIVE_MODE_ACK` unchanged. For the migration, review any old-domain checkout attempts in the same Stripe sandbox and resolve their status before disabling the hidden shop. Do not pay again to reconcile an uncertain result; wait for pending payments or deliberately expire unwanted open sessions in Stripe after review. A domain change is not evidence of any charge, refund or cancellation.

Already-created sessions retain their original success/cancel URLs. Old-domain cart and checkout-attempt receipts live in that origin's browser storage and do not transfer to the new domain. Retain those browser records while reconciling. The new domain may show an empty bag even though an older Stripe session exists; a bag is not payment history. The API journal and Stripe records remain authoritative for their respective observations/transactions.

After reconciling old attempts, temporarily set `TEST_SHOP_ENABLED=false`, set the new primary domain, and leave both routing aliases in place:

```dotenv
STORE_DOMAIN=gyaruinthemix.com
STORE_HOSTS=gyaruinthemix.alicef.me,gyaruinthemix.com
STRIPE_MODE=test
SALES_ENABLED=false
TEST_SHOP_ENABLED=false
```

For an existing **API-mode deployment only**, apply the new origin by recreating just the API:

```bash
cd ~/bouncer
docker compose config --quiet
docker compose up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 120 gyaruinthemix-api
curl --fail https://gyaruinthemix.com/api/health
curl --fail https://gyaruinthemix.com/api/catalog
```

Confirm the public catalog reports `mode: test` and `salesEnabled: false`, and hidden API routes return 404 while paused. In Payment Links mode there is no API service or webhook; keep that mode and recreate only web to apply its environment. Review any configured Payment Link post-payment redirects in Stripe separately; changing source code does not edit them.

The image updater alone does not apply `.env` changes when images are unchanged. New API sessions will use `https://gyaruinthemix.com/shop/success/` and `/shop/cancel/`; if sandbox testing is later re-enabled, its paths remain `/shop-test/success/?session_id={CHECKOUT_SESSION_ID}` and `/shop-test/cancel/`. Old-host and `www` browser origins remain rejected by checkout/status endpoints.

## 4. Move the existing sandbox webhook destination

In the **same Stripe sandbox**, edit the existing webhook destination URL to:

```text
https://gyaruinthemix.com/api/stripe/webhook
```

Preserve its API version and the existing `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` subscriptions. A URL update and signing-secret rotation are separate Stripe operations; do not rotate the mounted secret solely because the hostname changed. Verify the destination's signing configuration and successful signed delivery after editing, using an appropriate existing sandbox event rather than creating a payment for this migration.

If a new destination is created instead, it has its **own** signing secret. This application accepts one configured webhook secret, so do not assume old and new destinations can both deliver successfully with different secrets. The owner must enter any replacement secret locally using `scripts/setup-secret.sh stripe_webhook_secret --docker` from `~/bouncer/gyaruinthemix` and recreate the API. Never paste a secret into chat, a PR, `.env` or a shell argument. Keep the restricted API key unchanged unless a separately reviewed credential change is required.

Do not redirect the old webhook URL: Stripe treats HTTP 3xx as failed delivery. Keep old routing available until the destination change and new-host signed delivery are verified. Webhooks remain available while the hidden shop is disabled, but matching sandbox events are then acknowledged without recording a sandbox payment observation. This paused-state check proves signature/delivery handling, not sandbox payment processing. Review Stripe delivery status; a successful page visit or unsigned HTTP probe cannot prove webhook processing.

## 5. Verify, then decide whether to redirect the old site

Check new-host artist pages, `/contact/`, canonical/OG URLs, `/robots.txt`, `/sitemap.xml`, assets and TLS. The sitemap must omit `/shop-test/` and checkout-return pages. Check the unchanged ZNC/Limnoria container IDs/start times and real client connections. Public sales stay disabled.

Re-enabling the hidden sandbox and running a fresh hosted checkout is a separate deliberate test decision. Do not turn it on or make a payment just to complete the hostname migration. When testing is authorized, use a fresh new-domain attempt and verify cancellation, return/status behavior and signed webhook observations in the same sandbox; never infer success from the bag or success page alone.

No old-host redirect is installed by this change. While both aliases are retained, old artist links keep loading; after the API-origin switch, old-host checkout/status requests are rejected. Move saved shop links to the apex. Once pending sessions and webhook delivery are settled, a reviewed path/query-preserving browser redirect can be added at the existing edge, with explicit `/api/*` handling. Inspect that edge's actual configuration before implementing it; do not blindly add a second public proxy or a blanket webhook redirect. Removing the old alias before arranging the redirect would break old links.

Resume the existing website updater only after the intended configuration and release have passed these checks. DNS/provider changes, certificate issuance, Stripe configuration, redirects and VPS activation remain separate operator actions.

## Rollback

Keep both hosts routed while investigating. With sandbox testing paused and no new-origin attempts pending, restore the recorded `STORE_DOMAIN` and recreate the API, and restore the existing Stripe endpoint URL if it was changed. If new-origin attempts exist, reconcile them before switching back. Restore the previous `STORE_HOSTS` and recreate web only if the routing change itself must be undone. Do not remove DNS/certificates that pending sessions or webhook retries still require.

Image rollback alone cannot restore `.env`, Compose, DNS, browser storage or Stripe destination settings. Retain the API journal and current valid secret files; never restore revoked credentials. A previous web image can be restored using the [existing release rollback procedure](README.md#updates-to-infrastructure-checkout-mode-and-rollback).

## References

- [nginx-proxy multiple hosts](https://github.com/nginx-proxy/nginx-proxy/blob/main/docs/README.md#multiple-hosts)
- [acme-companion multi-domain certificates](https://github.com/nginx-proxy/acme-companion/wiki/Let's-Encrypt-and-ACME#multi-domains-certificates)
- [Stripe endpoint URL updates](https://docs.stripe.com/api/webhook_endpoints/update)
- [Stripe endpoint signing secrets](https://docs.stripe.com/webhooks#roll-endpoint-signing-secrets-periodically)
- [Stripe webhook redirects are failures](https://support.stripe.com/questions/webhooks-what-to-do-when-the-http-status-code-starts-with-a-three-%283xx%29?locale=en-GB)
