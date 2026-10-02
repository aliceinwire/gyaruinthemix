# Stripe Checkout without keeping a Stripe key

This is the default deployment. The website serves ordinary links to Stripe-hosted payment pages created in the **Stripe Dashboard**. The VPS needs no Stripe secret key, publishable key, webhook signing secret, Checkout API process or payment state. Customers enter card and delivery information on Stripe.

The artist website and fan hub work before checkout is configured. The supplied products stay `coming_soon`, with `displayPriceJPY: null` and `paymentLink: null`; no final prices or working payment links are invented.

## Start the website

Follow [the bouncer installation guide](bouncer/README.md), the only deployment path: install its Compose file, set your domain, and confirm the public GHCR images are available. Then pull and start only the website:

```bash
cd ~/bouncer
docker compose pull gyaruinthemix-web
docker compose up -d --no-deps --no-build --pull never --wait gyaruinthemix-web
```

Leave `CHECKOUT_MODE=payment_links`, select `GYARUINTHEMIX_WEB_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-web:main` in `~/bouncer/.env`, and leave the optional `checkout-api` profile disabled. You do **not** need to create `secrets/stripe_secret_key` or `secrets/stripe_webhook_secret`. `/web-health` is the web health check; `/api/*` deliberately returns 404. No webhook destination should target this deployment.

For local development, Node 24 is sufficient:

```bash
npm ci
npm run images
npm run dev
```

Open `http://localhost:4321`. No API process, Stripe CLI login or credentials are required. Production uses the static Docker image, never the development server.

## Configure TEST checkout in Stripe

1. Select a Stripe **sandbox / test environment** in the Dashboard. Create each real merchandise product with a one-time, fixed **JPY price, including tax**. Do not choose a subscription or customer-entered amount.
2. Create a **Payment Link** for that product, or for a deliberate fixed bundle. Use the Dashboard UI; creating links through Stripe's API would require credentials, which this approach avoids.
3. Configure quantity adjustment in Stripe if wanted. Set its maximum to the product's `maxQuantity` (currently 5). The site's JSON cannot enforce quantities on an external payment page.
4. Require shipping addresses and restrict shipping destinations to **Japan only**. Add your actual shipping rate and verify it in the hosted page. Do not silently use zero postage or leave worldwide destinations enabled. Stripe Dashboard configuration is the enforcement point in this mode.
5. Enable appropriate receipt/payment notification settings. Under the link's **After payment** options, use Stripe's confirmation page or redirect to `https://YOUR_REAL_DOMAIN/shop/success/`. Do not add a Checkout Session ID or personal data to the URL. Payment Links return behavior is configured in Stripe; it does not use the custom API's `cancel_url`. Test browser Back and the link's actual return controls.
6. Copy the public `https://buy.stripe.com/test_...` URL. In `config/products.json`, set that product's `paymentLink` to the **complete, unmodified** URL, `displayPriceJPY` to its exact integer JPY price, and `availability` to `available`. The ellipsis shown here is documentation, not a usable link. Keep credentials out of all JSON files.
7. Complete/review `config/store.json`, product specifications, actual product photos, shipping/returns terms and homepage launch copy. In `config/payment-links.json`, retain `mode: "test"`, then set `configurationReviewed: true` and `salesEnabled: true` only after checking steps 1–6.
8. Run tests/lint and review the build. Publish a reviewed release through the trusted `main` CI workflow, then deploy **only the website** using the bouncer guide. If the optional update scheduler is enabled and follows `main`, it will pick up the image after publication. Static prices and links are baked into that image; restarting an old image does not update them.

Prices on this site use Japanese formatting, for example `¥800`, `¥1,500`, `¥3,000` (format examples only). Stripe's current documentation says **Adaptive Pricing is always enabled for Payment Links**. Although products are configured in JPY and shipping is Japan-only, Stripe can offer localized presentment currency. If strictly JPY-only checkout for every visitor is essential, use the optional API mode instead. Verify the actual hosted checkout in your account; the static website cannot override Stripe's currency behavior.

### What you get / tradeoff

Each button opens a predefined product or bundle. You can configure supported quantity adjustments and optional products in Stripe. An arbitrary multi-product website cart cannot be converted into a new Checkout Session without an authenticated server/API operation. The existing cart remains available through [optional API mode](../README.md#optional-custom-cart-api-mode).

The static site validates URL safety, test/live URL mode, availability and integer display prices at build time. It cannot authenticate to Stripe to verify that a link belongs to your account, is still active, contains the correct items, matches the displayed price, or enforces shipping/quantity rules. `configurationReviewed` records your manual review of those settings; it is not automated verification. Review every link in Stripe after each change.

## TEST smoke procedure

Run Docker commands from `~/bouncer`. Pause the optional image-update scheduler during maintenance/testing so it cannot race manual restarts, then resume it after verifying the result using the [bouncer guide](bouncer/README.md).

1. Confirm `docker compose ps gyaruinthemix-web` is healthy. Check HTTP redirects to HTTPS, the valid certificate, `/web-health`, artist pages, shop, photos, mobile layout and keyboard access. `/api/health` and `/api/stripe/webhook` should return **404**, even without secret files.
2. With JavaScript disabled, open a configured purchase link. Confirm Stripe's test indicator, correct products, JPY base prices, quantity limits, Japan-only address choices and exact shipping/total. Never use real card details for testing; use [Stripe's documented test payment details](https://docs.stripe.com/testing).
3. Leave checkout and return to the shop without payment. Then complete a TEST payment and verify the actual paid transaction in the Stripe Dashboard. Test your selected confirmation/redirect behavior. Open `/shop/success/` directly: it must not create an order, confirm payment or trigger shipment.
4. Restart **only** `gyaruinthemix-web`, check health and repeat navigation. Confirm ZNC/Limnoria still have the same container IDs/start times and functioning connections. Inspect memory on the target VPS; CI does not measure that machine.
5. Record date, image tag and the results. No live-mode configuration should be enabled until these tests pass.

The GitHub Actions bouncer checks are designed to test website startup with **no secret files**, one running website container, the API profile disabled, active synthetic public test links, headers/assets and restart recovery. Consult the exact commit's Actions result for execution evidence. They never start the real proxy/IRC workloads, open synthetic payment links or call Stripe. A real TEST payment in your account remains your deployment check.

## Orders, fulfillment and backups

Stripe is the authoritative payment/order record. Check paid status in the Dashboard before manually fulfilling; delayed payments may remain pending. Track manual shipments consistently to avoid duplication. The success page and a customer screenshot are not evidence of payment. There is no automated fulfillment, email sender, local webhook listener or order database in this mode.

Back up source and bouncer deployment configuration, including environment settings and the manually installed updater and cron/systemd configuration. No application payment volume or secret backup is needed for a fresh Payment Links deployment. Stripe account access, records, Dashboard link configuration and order operations still need your normal account protection and retention process. Automated fulfillment later requires a verified webhook handler and durable idempotent order state, or an explicitly chosen external fulfillment provider; do not attach side effects to the success page.

## Deliberate LIVE transition, only after TEST passes

Finish seller details and Stripe account activation. Create separate LIVE products, prices, domestic shipping settings and Payment Links; test URLs are not live URLs. Replace all configured test links with their corresponding LIVE `https://buy.stripe.com/...` URLs and recheck every displayed price. Set `mode: "live"` and `liveModeAck: "I_HAVE_COMPLETED_TEST_CHECKOUT"` in `config/payment-links.json`. Live sales also require all seller fields to be filled and `configurationReviewed: true`.

Build/review the static shop, then release it through the trusted CI publication and bouncer deployment procedure. This still needs **no Stripe credentials on the VPS or in GitHub**. There is no automatic mode switch or authorized real-money test. Preserve the previous image for rollback; the build rejects mixed test/live links.

## Updates, pausing and rollback

Change the Stripe configuration and matching public JSON together, then release and deploy a new web image. The [bouncer updater](bouncer/README.md) optionally polls GHCR every five minutes and restarts only the configured website services without a build. It attempts rollback on health failure and remembers failed image IDs; use `--retry` only after diagnosis. Compose, updater/scheduler, environment and other deployment/configuration changes must still be installed manually. The packages must be publicly readable and the scheduler explicitly enabled; neither has been done by this source change. To pause sales, **deactivate the Payment Links in Stripe**, then set `salesEnabled: false` and rebuild web. Hiding a link or rolling back a site image does not disable a previously shared payment URL or erase an existing payment. Handle pending/open checkouts in Stripe. Use Stripe's inventory/payment limits where appropriate; the static site's availability is not an inventory system.

For manual rollback, pause the scheduler, set `GYARUINTHEMIX_WEB_IMAGE` to a known-good `ghcr.io/aliceinwire/gyaruinthemix-web:sha-<full commit hash>` release and follow the scoped pull/start procedure in the bouncer guide. Retain matching public configuration and confirm its links are still appropriate; a site rollback does not change Stripe. Keep references pinned or the timer paused while investigating so an automatic tick does not replace the selected release. If you previously ran API mode, pause the scheduler and follow the bouncer mode-switch procedure. Changing profiles does not automatically remove its running container or delete secrets. After reconciling in-flight API orders and webhook deliveries, from `~/bouncer`, use the old API-enabled configuration to stop/remove **only** `gyaruinthemix-api` (`docker compose stop gyaruinthemix-api`, then `docker compose rm -f gyaruinthemix-api`). Disable that application's old webhook destination in Stripe and revoke its key if no other application uses it. Remove its two local secret files when no longer needed, while retaining any required journal backup. Never remove unrelated service credentials, containers or volumes.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase button disabled                         | Product availability, `salesEnabled`, actual display price and Payment Link; rebuild the image after editing.                                        |
| Build rejects configuration                      | Plain HTTPS `buy.stripe.com` link, correct test/live mode, integer JPY price, explicit review and live acknowledgment where relevant.                |
| Stripe shows a different amount or shipping rule | Correct the Stripe Dashboard and the matching public product data; do not attempt to pass a browser-supplied amount.                                 |
| API returns 404                                  | Expected in Payment Links mode. Use `/web-health`; no API/webhook is running.                                                                        |
| API still runs after changing modes              | Profiles don't stop an existing container. Follow the migration procedure above, preserving records.                                                 |
| Website still shows a cart                       | Select the `gyaruinthemix-web` image for Payment Links and follow the bouncer mode-switch procedure; runtime flags alone do not change static files. |

References: [Stripe Payment Links](https://docs.stripe.com/payment-links), [Dashboard creation and Adaptive Pricing](https://docs.stripe.com/payment-links/create), [customization/shipping](https://docs.stripe.com/payment-links/customize), [post-payment behavior](https://docs.stripe.com/payment-links/post-payment).
