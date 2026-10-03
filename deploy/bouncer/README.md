# Bouncer deployment and automatic website updates

This is the **only supported deployment**. Keep the existing `~/bouncer` Compose project and its proxy, certificate companion, ZNC and Limnoria. The added website has no published host ports and no Docker socket. Default Payment Links mode runs only `gyaruinthemix-web`, capped at 64 MiB. Optional API mode adds a 192 MiB cap and a private journal volume. These are provisional caps, not measured VPS usage.

After one-time activation, a merge into `main` runs CI, publishes tested website images to GHCR, and the host checks for them every five minutes. **This repository does not install the updater, change package visibility, connect to the VPS or deploy automatically until you activate it.** No SSH credential, webhook listener, new proxy or always-running updater container is needed. Builds happen on GitHub-hosted runners, not the 1 GB VPS.

## Release and trust boundary

- Pull requests run tests with read-only repository permissions and offline fixtures. They cannot publish images. Neither `pull_request_target` nor privileged `workflow_run` consumption is used.
- Only a `push` to `main` in `aliceinwire/gyaruinthemix`, after source, secret scanning and both bouncer-mode gates pass, can enter the package-write job. Protect `main` with reviews and the CI checks; account/branch settings are owner-managed.
- That job builds and smoke-tests the **actual release configuration** again, then publishes those exact local images. Synthetic public Payment Links are never published. A superseded main commit is skipped before publication.
- Images are `ghcr.io/aliceinwire/gyaruinthemix-web`, `gyaruinthemix-web-api` and `gyaruinthemix-api`. Each has `main` and `sha-<full-40-character-commit>` tags, source/revision labels, and a checkout-mode label on web images. Treat SHA tags as release names, not cryptographic immutability: package writers could overwrite tags. The host pins each activation to the pulled local content-addressed image ID.
- The host accepts only the documented repository's matching `:main` images. API/web revisions must match, so interrupted publication cannot activate a mixed pair. Labels are consistency checks, not image signatures. Trust is the protected GitHub repository and GHCR package write access. Limit both to maintainers.
- Updates use `up --no-deps --no-build --pull never --wait` with an explicit website service list. They never pull, build, reconcile or stop the four shared services. The existing proxy may perform its normal routing reload when website containers change.
- Health failure restores the previous healthy website images and blocks that failed image pair until a new release or explicit `--retry`. A local lock prevents overlapping runs. Recorded pending state lets the next run recover an interrupted update. This is not zero-downtime deployment; a short website interruption is possible.

## 1. Prerequisites and read-only inspection

Use the existing VPS deployment user and its established Docker access. Do not grant new Docker-group/root privileges merely to run this guide: Docker administration is effectively host-root access. The updater requires Python 3, a local Unix-socket Docker context and Docker Compose v2 with `--wait` support. The published images currently target **linux/amd64**; verify `docker info --format '{{.Architecture}}'` reports `x86_64` or `amd64`. An ARM host needs a separately tested CI image-build change first; the updater refuses it without changing containers.

Keep this layout:

```text
~/bouncer/docker-compose.yml
~/bouncer/.env
~/bouncer/proxy/                 existing, unchanged
~/bouncer/znc-docker/            existing, unchanged
~/bouncer/znc-data/              existing, unchanged
~/bouncer/bot_config/            existing, unchanged
~/bouncer/gyaruinthemix/         this repository
```

From a reviewed checkout already placed at `~/bouncer/gyaruinthemix`:

```bash
bash ~/bouncer/gyaruinthemix/scripts/preflight.sh ~/bouncer
cd ~/bouncer
df -h .
docker compose version
docker info --format '{{.Architecture}}'
docker inspect znc limnoria --format '{{.Name}} id={{.Id}} started={{.State.StartedAt}} project={{index .Config.Labels "com.docker.compose.project"}}'
```

Record the existing project name, IDs/start times, network membership, memory and disk availability. Preserve the current project name in `~/bouncer/.env` if your deployment previously supplied `COMPOSE_PROJECT_NAME` only in the shell. The updater deliberately ignores inherited shell-level Compose overrides and reads this installed file and `.env`. Do not rename the directory/project or introduce another deployment.

The `nginx-proxy` network and old services must already exist. Check the website hostname is distinct from `znc.alicef.me`, its DNS points to the VPS, and the existing certificate companion can issue its certificate. The existing proxy version/TLS behavior and actual available memory still require inspection on your host.

## 2. Install the merged configuration and first release

Review the diff against your current Compose file. The four supplied original service definitions, existing volumes and existing network definition are preserved in this repository; reconcile any later local edits before installation. Back up the existing file without overwriting an earlier backup:

```bash
cd ~/bouncer
cp -n docker-compose.yml docker-compose.yml.before-gyaruinthemix
cp gyaruinthemix/deploy/bouncer/docker-compose.yml docker-compose.yml
```

Edit the **existing** `~/bouncer/.env` using [`.env.example`](.env.example) as a checklist; preserve unrelated values and the established project name. Set `STORE_DOMAIN` to the real bare hostname and review `LETSENCRYPT_EMAIL`. Default mode is `CHECKOUT_MODE=payment_links`, with no `checkout-api` profile and no Stripe secret files. Do not enable sales just to deploy the artist website.

The first successful trusted-main CI run creates the GHCR packages. GitHub initially makes new container packages private. After reviewing their contents, the owner can make the three release packages public in GitHub package settings so the VPS can pull without storing a token. **Changing package visibility is an owner action and is not performed by this change.** If public images are unsuitable, arrange narrowly scoped existing registry access separately; do not put tokens in this repository, `.env` or a cron command. Pull failure leaves the current site untouched.

Once the first release is published and accessible:

```bash
cd ~/bouncer
docker compose config --quiet
docker compose pull gyaruinthemix-web
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 120 gyaruinthemix-web
docker compose ps gyaruinthemix-web
curl --fail https://YOUR_REAL_DOMAIN/web-health
```

Verify HTTP redirects to HTTPS and the certificate is valid, without `curl -k`. Check all artist pages, `/contact/`, photos and mobile navigation. Confirm `/api/health` is 404 in default mode. Recheck the same ZNC/Limnoria IDs/start times and their real client connections. Follow the [Payment Links TEST procedure](../PAYMENT-LINKS.md) before enabling any sales. Container health alone does not prove external TLS/routing or payment correctness.

## 3. Activate automatic checks once

First run the updater manually from the existing deployment user. It requires one running, healthy container per selected website service, so the first-start procedure above must already have passed:

```bash
/usr/bin/python3 "$HOME/bouncer/gyaruinthemix/deploy/bouncer/update.py" --directory "$HOME/bouncer"
```

Choose **one** scheduler. Do not install both. The lock still prevents accidental overlap.

### Portable cron, including OpenRC hosts

Use the deployment user's existing `crontab -e`; preserve all existing jobs. Add this single line, adjusting the Python path if necessary:

```cron
*/5 * * * * PATH=/usr/local/bin:/usr/bin:/bin /usr/bin/python3 "$HOME/bouncer/gyaruinthemix/deploy/bouncer/update.py" --directory "$HOME/bouncer" 2>&1 | /usr/bin/logger -t gyaruinthemix-update
```

Your existing cron daemon must already run at boot. Confirm the entry with `crontab -l` and check your system's existing syslog for `gyaruinthemix-update`. Cron service installation/enabling depends on the host's init system and is an operator step, not part of this repository. To pause, comment out only this line; restore it to resume. No SSH session has to remain open.

### Systemd user timer, when systemd is present

```bash
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/bouncer/gyaruinthemix/deploy/bouncer/systemd/gyaruinthemix-update."{service,timer} "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now gyaruinthemix-update.timer
systemctl --user list-timers gyaruinthemix-update.timer
journalctl --user -u gyaruinthemix-update.service -n 30 --no-pager
```

For a user timer to survive logout/reboot, the account must have user lingering enabled. Check `loginctl show-user "$USER" -p Linger`; if needed, the operator can deliberately enable it with `sudo loginctl enable-linger "$USER"`. Do not assume a successful interactive timer means boot persistence is configured.

Pause with `systemctl --user disable --now gyaruinthemix-update.timer`; resume with `systemctl --user enable --now gyaruinthemix-update.timer`. An already-running service may finish after pausing the timer; check its status before manual operations. The updater lock file also coordinates direct invocations, but plain manual Docker commands do not acquire it.

## 4. Verify a merged update

A merge is followed by the complete CI run and registry publication, then the next host check (normally within five minutes, with up to 30 seconds of timer jitter). A failed CI run leaves registry release tags unchanged. The host performs no Git pull and executes no new repository scripts automatically.

Check the **Publish tested main images** job, then the host's cron logs or systemd journal. Inspect the running revision:

```bash
cd ~/bouncer
id=$(docker compose ps -q gyaruinthemix-web)
docker inspect "$id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Health.Status}}'
curl --fail https://YOUR_REAL_DOMAIN/web-health
```

Compare it with the merged main commit. Recheck the changed page over public HTTPS. The state file `~/bouncer/.gyaruinthemix-update.json` contains image IDs/revision and rollback bookkeeping, never credentials. Keep it local. This setup logs failures but does not add email or chat notifications; use your existing host monitoring for failed cron jobs/services, disk pressure and health.

## Updates to infrastructure, checkout mode and rollback

Only images auto-update. Changes to the merged Compose file, `.env`, secret paths, updater or timer need explicit review and manual installation from the approved commit. Do not replace shared infrastructure automatically. Pause the scheduler, ensure no update is active, back up configuration, copy only the reviewed deployment changes, then revalidate/restart only website services. Preserve the API journal/current valid secrets. The running website image is authoritative for content; an old checkout on the VPS is not rebuilt by the updater.

For an intentional rollback, pause the scheduler first. Choose a verified earlier release SHA from GHCR/CI, set `GYARUINTHEMIX_WEB_IMAGE` to its `:sha-<commit>` tag in `~/bouncer/.env`, and in API mode pin `GYARUINTHEMIX_API_IMAGE` to the **same** commit too. Pull and activate only the selected services using the scoped first-start command. Validate health/public pages and the implications of old payment links or product configuration. Restore `:main` and resume scheduling only after the failed release is fixed. Pinned tags intentionally cause the updater to stop rather than silently override the operator's choice.

For an automatically rejected release, inspect website logs/resources and correct the cause. To deliberately retry that same release after investigation:

```bash
/usr/bin/python3 "$HOME/bouncer/gyaruinthemix/deploy/bouncer/update.py" --directory "$HOME/bouncer" --retry
```

A different published image pair is tried normally. If both activation and rollback fail, pending state remains so the next run attempts recovery before any new update; inspect and repair the host rather than deleting state/journal files. No updater can guarantee recovery after host/storage failure. Retain previous image layers for rollback and monitor disk use. There is **no automatic global image/volume pruning**; do not use `docker system prune`, `docker volume prune`, `down -v`, `--remove-orphans` or blanket builds on this shared host.

### Optional API mode

Pause updates before changing mode. Set `CHECKOUT_MODE=api`, `COMPOSE_PROFILES=checkout-api`, and `GYARUINTHEMIX_WEB_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-web-api:main` in `~/bouncer/.env`; keep `GYARUINTHEMIX_API_IMAGE=ghcr.io/aliceinwire/gyaruinthemix-api:main`. Set up restricted TEST credentials and settings using [the README](../../README.md#optional-custom-cart-api-mode) and [SECURITY.md](../../SECURITY.md). Sales remain false until deliberately reviewed.

For this first start, choose one successful published release's full commit SHA and set `RELEASE_SHA` in the shell. Pin both image names to that same release before pulling/activating, so a `:main` publication in progress cannot mix revisions:

```bash
cd ~/bouncer
: "${RELEASE_SHA:?Set the verified full release SHA first}"
export GYARUINTHEMIX_WEB_IMAGE="ghcr.io/aliceinwire/gyaruinthemix-web-api:sha-$RELEASE_SHA"
export GYARUINTHEMIX_API_IMAGE="ghcr.io/aliceinwire/gyaruinthemix-api:sha-$RELEASE_SHA"
docker compose config --quiet
docker compose pull gyaruinthemix-web gyaruinthemix-api
test "$(docker image inspect "$GYARUINTHEMIX_WEB_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA" &&
test "$(docker image inspect "$GYARUINTHEMIX_API_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$RELEASE_SHA" &&
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 120 gyaruinthemix-web gyaruinthemix-api
unset GYARUINTHEMIX_WEB_IMAGE GYARUINTHEMIX_API_IMAGE
```

Keep the matching `:main` settings in `~/bouncer/.env` for subsequent automatic checks. Verify both services are healthy afterward. Complete the account-specific TEST checkout/webhook procedure and resume updates. The API never joins the shared proxy network and no public API port is added.

When returning to Payment Links, first reconcile pending API orders/webhooks and follow the [migration checklist](../PAYMENT-LINKS.md#updates-pausing-and-rollback). Stop/remove only the old website API container while its profile is still enabled; preserve the journal and any required backups. Then change the web image back to `gyaruinthemix-web:main`, set `CHECKOUT_MODE=payment_links`, remove the API profile, activate only web and verify API URLs return 404. Changing a profile alone does not stop a running API. The updater refuses a detected mixed-mode deployment rather than deciding this migration for you.

## References

- [GitHub Container registry, package visibility and authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub publishing container images](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [Docker Compose up: scoped services, no-deps, no-build, pull and wait](https://docs.docker.com/reference/cli/docker/compose/up/)

## Hidden sandbox shop switch

See [the hidden sandbox shop procedure](../../README.md#hidden-sandbox-shop). It uses the API-mode web image and `checkout-api` profile, with `STRIPE_MODE=test`, `SALES_ENABLED=false` and the new `TEST_SHOP_ENABLED` setting (default `false`). The API refuses live credentials/mode or enabled public sales when that switch is on. Configure the four sandbox Price IDs and Japan shipping rate first. Install the updated Compose definition before recreating the API: the image updater alone does not add the new environment variable to an existing container. `/shop/` and its catalog stay closed; only `/shop-test/` can use the isolated sandbox API. The hidden URL is not authentication.
