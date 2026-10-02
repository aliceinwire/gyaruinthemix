# Stripe security and incident response

Default Payment Links mode uses no Stripe API credentials. The key requirements below apply to the optional custom-cart API. Existing proxy, ZNC and Limnoria definitions are unchanged.

## Restricted keys are required

The API and secret setup script accept only **`rk_test_...` or `rk_live_...`**, matching `STRIPE_MODE`. They reject unrestricted `sk_...`, publishable `pk_...`, malformed and wrong-mode keys. Existing API deployments using unrestricted keys must migrate before upgrading. There is no unrestricted-key override. Key-free deployment is unaffected.

The existing filename `secrets/stripe_secret_key` and setting `STRIPE_SECRET_KEY_FILE` remain compatible. A restricted key is still secret: never put its value in `.env`, Astro public variables, JSON, source, Docker build arguments, GitHub Actions, issues or chat.

### Stripe Dashboard setup

Create a restricted key dedicated to this store in a Stripe **sandbox/test environment**, starting with no permissions. The source-derived starting policy is:

| Resource            | Permission | Use                                                                                   |
| ------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Checkout Sessions   | Write      | Create hosted Checkout Sessions                                                       |
| Prices              | Read       | Retrieve configured JPY Prices                                                        |
| Products            | Read       | Expand and validate each Price's Product                                              |
| Shipping Rates      | Read       | Retrieve the Japan shipping rate                                                      |
| Unrelated resources | None       | No refunds, payouts, transfers, account administration, Connect or Billing operations |

Enter the key through the hidden prompt, then test catalog loading, complete TEST checkout and signed webhook delivery. Review the key's **View request logs** in Stripe Workbench. If a failed request identifies a required dependent permission, review and grant only that permission, then repeat the test. Do not grant everything to resolve an error. Create a separate LIVE restricted key with the verified permissions only after the TEST flow passes.

The `rk_` prefix does **not** prove minimal permissions. The application cannot inspect Dashboard policy from the prefix. This table is based on the calls in `api/catalog.mjs` and `api/app.mjs`; account-specific permissions must be tested in Stripe. Offline CI does not contact your account.

Create an **IP addresses** policy under [Stripe Access policies](https://dashboard.stripe.com/api-access-policies), then attach it to the LIVE key via **Manage access policy**. Allow only the stable public **outbound IPv4 address** Stripe sees for the VPS. Verify that address in Stripe request logs; do not use a private Docker address or Cloudflare's inbound address. Stripe's current IP policy supports IPv4. Verify connectivity before enforcement and do not allow an entire provider range to resolve errors. This changes Stripe authorization, not VPS firewall rules or inbound webhook delivery. It does not block an attacker already running code on the allowed VPS.

Protect the Stripe Dashboard with passkeys, restrict team access to key management, secure the associated email/recovery methods, and keep account security notifications enabled. Regularly review API logs and unexpected financial/account changes. Passkeys protect account login; they do not stop use of an already-stolen API key. These Dashboard controls require owner configuration and are not automatically applied by this repository.

## File and container protections

From `~/bouncer/gyaruinthemix`, enter values only into hidden prompts:

```bash
bash scripts/setup-secret.sh stripe_secret_key --docker
bash scripts/setup-secret.sh stripe_webhook_secret --docker
```

Use `--local` for development. The script disables shell tracing, rejects a symlinked secrets directory and atomically replaces only the selected file after validation. Rejected input preserves the existing file. Docker files use 0440/group 10001, local files use 0600, and the parent directory is 0700. Inspect metadata without printing values:

```bash
stat -c '%a %u %g %n' secrets secrets/stripe_secret_key secrets/stripe_webhook_secret
```

Production accepts only small, nonempty regular secret files. It rejects executable permissions, group write permission and all access by other users. Modes 0400/0440/0600/0640 are supported when the API can read them. Account for user-namespace ownership without widening permissions. Configuration errors omit values and paths.

Only the API receives `/run/secrets/` mounts. The web receives neither key. Existing container hardening, safe logs, image/Git exclusions and webhook verification remain in place. Ordinary Compose file secrets **do not encrypt source files**. Protect host access and encrypted backups; Docker administrators or a compromised API/host may still read required credentials. No vault server or extra runtime service is added to the 1 GB VPS.

## Secret scanning before commits and in CI

The **Secret scanning** Actions job installs Gitleaks 8.30.1 with pinned SHA-256 verification, exercises synthetic detection tests, then scans the entire fetched Git history with redacted output. Container validation and image publication are gated on it. No production credentials, scanner account or paid scanner action is needed.

`.gitleaks.toml` extends upstream rules and adds restricted/unrestricted Stripe TEST/LIVE keys and webhook signing secrets. Only exact nonfunctional fixtures are allowed; no test-file blanket exemptions, inline allow comments or fingerprint ignore file are honored. Tests cover staged content differing from the working tree, actual commit blocking, removed historical secrets and output redaction.

On a development machine, install the same CLI and opt into the hook:

```bash
bash scripts/install-gitleaks.sh "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
npm run test:secret-scan
npm run security:scan
npm run security:hooks
```

Hook installation refuses to overwrite existing custom hooks. In that case, integrate `bash scripts/scan-secrets.sh staged` into your existing pre-commit hook. The installed hook fails if the pinned scanner is missing or detects a secret. Local hooks can be bypassed: require **Secret scanning** and the other CI checks in your GitHub branch rules. GitHub-native secret scanning/push protection, where available, is another owner-configured defense; this change does not enable account settings automatically.

Scanning is not proof of absence: encoded/fragmented credentials or formats outside the rules may evade detection. CI runs after a push, so a real key caught there must already be considered exposed. Revoke it; do not add it to the allowlist or publish raw scanner reports.

## Image publication and VPS updates

`deploy/bouncer` is the only deployment. CI validates pull requests and `main`; only successful checks for a trusted `main` push in `aliceinwire/gyaruinthemix` authorize the workflow's GHCR publication job. That job alone has package-write permission and uses GitHub's built-in token. No additional SSH/deploy secret or Stripe key belongs in GitHub. Pull requests and manual validation do not publish images. Protect the repository and its branch rules: permission to change trusted release code can ultimately change the website running on an opted-in VPS.

The three public packages separate the key-free frontend, API-mode frontend and optional API. Images carry source/revision labels and `main` / `sha-<full commit hash>` tags. Record resolved digests for stronger release identification; a registry tag is not an immutable security boundary. The owner must make GHCR packages publicly readable after the first trusted publish. Do not solve a failed anonymous pull by copying Stripe credentials or a broad GitHub token to the VPS.

The opt-in cron job or systemd user timer polls every five minutes through `deploy/bouncer/update.py`. It pulls images without building and targets only `gyaruinthemix-web` plus the optional `gyaruinthemix-api`, with health checks and a rollback attempt on failed startup. It remembers failed releases; an operator must diagnose them before using `--retry`. Health checks are a deployment signal, not proof that an image is harmless or checkout works. Inspect updater logs and verify recovery if rollback itself fails.

The updater needs the deployment user's existing access to Docker; that access is security-sensitive because Docker administration can expose mounted secrets and other host resources. Restrict access to the user, installed updater, systemd units and bouncer configuration. It does not add a Docker socket to the website containers. Keep the updater and configuration reviewed and manually maintained: the timer updates **application images only**, not source checkouts, Compose, systemd units, secrets or Stripe/Dashboard settings. Pause it for maintenance, mode changes, secret rotation, incident recovery and manual rollback, and resume only after verification. See the [installation, pause and rollback procedure](deploy/bouncer/README.md).

## Planned rotation and migration

1. Create a replacement restricted key with minimal permissions and the access policy. Validate the corresponding TEST flow. A short overlap is appropriate only for planned rotation of an unexposed key.
2. Enter the replacement through `scripts/setup-secret.sh stripe_secret_key --docker`. Keep `STRIPE_MODE` aligned. Preserve the journal and existing webhook destination.
3. With API mode enabled in `~/bouncer/.env`, pause the optional update scheduler as described in the [bouncer guide](deploy/bouncer/README.md), then recreate only the API:

```bash
cd ~/bouncer
docker compose config --quiet
docker compose up -d --no-deps --no-build --pull never --force-recreate --wait gyaruinthemix-api
docker compose ps gyaruinthemix-api
curl --fail https://YOUR_REAL_DOMAIN/api/health
```

4. Verify catalog requests in the replacement key's logs and complete the TEST procedure before live launch. For LIVE rotation verify expected API requests; do not create a real-money purchase unless deliberately intended. Revoke the old key once replacement usage is confirmed. Verify service health before resuming the scheduler.

An atomic secret-file replacement changes its inode, so a plain restart does not refresh an existing bind mount. Recreate the API as above. Key rotation needs no static image rebuild or restart of proxy, companion, ZNC or Limnoria. API-key rotation does not rotate the separate webhook signing secret. Never restore a revoked/leaked key during rollback.

## If a key leaks

1. From a trusted device, open Stripe directly and **expire the key immediately**, or rotate with expiration **Now**. Treat exposure as compromise even without known misuse. Deleting a Git commit or changing the Dashboard password does not revoke an API key. Expect custom-cart checkout to be unavailable until recovery; static artist pages can remain online.
2. Review Workbench logs, charges, refunds, transfers, payout destinations, connected accounts and webhook destinations. Preserve the exposure window and suspicious request/event IDs privately, without secret values or unnecessary customer data. Contact Stripe promptly if money moved unexpectedly and request help pausing/reversing unauthorized activity. Recovery is not guaranteed.
3. Close the leak before installing another key. Remove exposed copies from Git history, logs, artifacts and caches after revocation; a rewrite cannot erase other people's copies. If the API/host was compromised, contain and recover it before supplying new credentials. Do not run blanket Compose shutdowns or cleanup against this shared VPS.
4. Rotate other potentially exposed credentials. An exposed `whsec_...` needs its own endpoint-secret rotation in Stripe. Audit unexpected webhook destinations and permission changes as well.
5. Install a new restricted key on the recovered environment, recreate only API, verify health/catalog/TEST checkout and signed webhooks, and monitor for misuse. Reconcile pending orders in Stripe; browser success pages and application logs never authorize fulfillment.

Do not post credentials, complete webhook payloads or customer addresses in public issues. Use GitHub private vulnerability reporting if enabled, otherwise arrange a private channel with the repository owner. Stripe account incidents also belong with Stripe Support.

## References

- [Restricted keys and permission testing](https://docs.stripe.com/keys/restricted-api-keys)
- [Access policies and rotation](https://docs.stripe.com/keys)
- [Key management](https://docs.stripe.com/keys-best-practices)
- [Compromised-key response](https://support.stripe.com/questions/protecting-against-compromised-api-keys)
- [Compose file secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
- [Pinned Gitleaks release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
