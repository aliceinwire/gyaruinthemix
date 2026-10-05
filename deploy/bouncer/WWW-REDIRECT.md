# Optional www redirect to the apex

The web image redirects `www.gyaruinthemix.com` to **https://gyaruinthemix.com** with HTTP **308**, preserving the original escaped path and query. It is available in both Payment Links and API images. No extra container, public port, bind mount, runtime template or shared-proxy edit is needed.

The destination is fixed in `nginx-www-redirect.conf`; it cannot be changed through a request's Host or forwarding headers. Nginx matches only the exact www hostname (also accepting normal case, port and trailing-dot variants). The apex, localhost and unrelated hosts keep their existing behavior. This does not restore or redirect the retired `gyaruinthemix.alicef.me` hostname.

`STORE_HOSTS` controls public routing and certificate names, not the image's redirect logic. Leaving it blank keeps the single-host deployment. The apex must already work over valid HTTPS and `STORE_DOMAIN` must remain `gyaruinthemix.com` before adding www. The API's exact origin, canonical metadata, checkout returns, sales settings and hidden test-shop settings do not change.

## Operator rollout

This procedure is manual. A PR or source/image update does not edit DNS, the installed Compose file, `.env`, certificates or Stripe. Keep the existing `~/bouncer` project identity and all shared services. Do not use a full-stack `up`, `down`, or `--shared` update for this change.

1. Wait until the reviewed change is merged, its main CI passes, and its web release image is published. Pause only the website updater scheduler using the [existing instructions](README.md#3-activate-automatic-checks-once), and let any active run finish. Record the current website image ID/revision and retain the previous `.env`/Compose settings for rollback. Do not record credentials.
2. At the authoritative DNS provider, add **CNAME `www` → `gyaruinthemix.com`** (or an A record to the same verified VPS IPv4). Do not combine a CNAME with other records at www. Preserve the apex record; do not restore the retired hostname. Only publish AAAA if the same service is reachable over that IPv6. Check restrictive CAA records and allow the existing companion's HTTP-01 validation on port 80. If a CDN is already in use, preserve valid origin TLS and its working ACME exception.
3. Confirm the records resolve as intended, and the apex is still healthy:

   ```bash
   dig +short CNAME www.gyaruinthemix.com
   dig +short A www.gyaruinthemix.com
   dig +short AAAA www.gyaruinthemix.com
   curl --fail --show-error https://gyaruinthemix.com/web-health
   ```

4. Check the installed `~/bouncer/docker-compose.yml` has the website's `VIRTUAL_HOST` and `LETSENCRYPT_HOST` expressions using `${STORE_HOSTS:-${STORE_DOMAIN:?...}}`, as in [this release's Compose file](docker-compose.yml). If necessary, reconcile just those website entries after a backup. Do not overwrite local changes or shared service definitions. In the existing `~/bouncer/.env`, set just:

   ```dotenv
   STORE_DOMAIN=gyaruinthemix.com
   STORE_HOSTS=gyaruinthemix.com,www.gyaruinthemix.com
   ```

   Keep the apex first, matching the companion's certificate base-name convention. Preserve the existing checkout mode and image family: `gyaruinthemix-web:main` for Payment Links or `gyaruinthemix-web-api:main` for API mode. Do not switch modes, enable public sales, change `TEST_SHOP_ENABLED` or edit any Stripe setting for this redirect.

5. Pull the reviewed web image, confirm its revision is the intended merged release, then recreate **only web**. The updater can skip unchanged images, so a `.env` edit alone is not sufficient.

   ```bash
   cd ~/bouncer
   docker compose config --quiet
   docker compose pull gyaruinthemix-web
   docker image inspect "$(docker compose config --images gyaruinthemix-web)" \
     --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
   # Continue only after checking the printed revision against the reviewed release.
   docker compose up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 120 gyaruinthemix-web
   docker compose exec -T gyaruinthemix-web nginx -t
   ```

   The existing proxy/companion should discover both names and obtain a certificate valid for www as well as the apex. Wait for successful issuance. Keep `ENABLE_HTTP_ON_MISSING_CERT=false`; never bypass certificate verification. No API recreation or shared-service restart is needed for an already-working apex deployment.

## Verification

Run without `-k`, and do not follow the first redirect when checking its target:

```bash
curl --silent --show-error --fail --path-as-is --output /dev/null --dump-header - \
  'https://www.gyaruinthemix.com/music/?source=www&tag=a%2Fb'
# Expected: 308; Location: https://gyaruinthemix.com/music/?source=www&tag=a%2Fb
curl --silent --show-error --fail --output /dev/null --dump-header - \
  'https://gyaruinthemix.com/music/?source=www&tag=a%2Fb'
# Expected: 200, with no www redirect loop.
curl --fail --show-error https://www.gyaruinthemix.com/web-health
curl --fail --show-error https://gyaruinthemix.com/web-health
# Both health paths return 200 and "ok" without an application redirect.
curl --silent --show-error --output /dev/null --dump-header - \
  'http://www.gyaruinthemix.com/music/?source=www&tag=a%2Fb'
# The existing edge can first redirect HTTP to HTTPS on www, then the web image
# redirects HTTPS www to the HTTPS apex. Verify the final host/path/query.
```

Also check apex pages, assets and `/shop-test/` according to its existing enabled/disabled state. In API mode, apex `/api/health` remains healthy, and `/api/catalog` retains its existing test/sales-disabled settings. In Payment Links mode, `/api/*` remains 404 on the apex. Compare shared-service container IDs/start times and real ZNC/Limnoria connections with the recorded baseline. Resume only the existing website updater after these checks pass.

### Health, ACME and API details

- `/web-health` is an exact-path exception. It stays 200, including container-local checks, and does not test external DNS, TLS or edge routing.
- The existing shared proxy and certificate companion must serve HTTP-01 challenges themselves. If `/.well-known/acme-challenge/` reaches this web image on www, it returns 404 without a redirect. That fail-closed response is **not** successful ACME validation. Container CI cannot prove real certificate issuance or renewal; inspect the companion's issuance result and verify valid public TLS for both names.
- Other www paths, including `/api/*`, return 308; clients following it retain their method. Start browser checkout from the apex. An API call with a www `Origin` remains rejected after following a redirect; no origins or CORS permissions are added.
- Stripe webhooks must already target **https://gyaruinthemix.com/api/stripe/webhook** directly. Stripe treats 3xx as failed delivery, so www is not a webhook endpoint or a webhook-migration mechanism. Do not send test payments or modify Stripe merely to verify this redirect.
- Browser storage is scoped to the origin and is not copied by a redirect. A www cart is not migrated; the apex remains the only supported checkout origin.

## Rollback

If adding www disrupts the apex or certificate issuance, restore the recorded routing settings in `.env` and recreate only web with the same command above. Restore the prior reviewed web image if the image itself regresses, following the [existing image rollback procedure](README.md#updates-to-infrastructure-checkout-mode-and-rollback). Retain the API journal and secret files. Do not change shared services. A rollback image without this redirect can serve www as an alias, so remove the optional www routing when reverting that image. A cached permanent redirect can persist in browsers after rollback.

## References

- [Nginx exact server-name selection](https://nginx.org/en/docs/http/server_names.html)
- [Nginx return and redirect status codes](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html#return)
- [ACME companion multi-domain certificates](https://github.com/nginx-proxy/acme-companion/wiki/Let's-Encrypt-and-ACME#multi-domains-certificates)
- [Stripe treats webhook redirects as failures](https://support.stripe.com/questions/webhooks-what-to-do-when-the-http-status-code-starts-with-a-three-%283xx%29?locale=en-GB)
