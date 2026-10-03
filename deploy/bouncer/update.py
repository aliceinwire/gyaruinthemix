#!/usr/bin/env python3
"""Update tested website images, with explicitly requested manual shared-service updates."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import time

SOURCE = "https://github.com/aliceinwire/gyaruinthemix"
REGISTRY = "ghcr.io/aliceinwire/gyaruinthemix-"
WEB = "gyaruinthemix-web"
API = "gyaruinthemix-api"


class UpdateError(RuntimeError):
    pass


class Updater:
    def __init__(self, directory, retry=False):
        self.directory = Path(directory).resolve()
        self.state_path = self.directory / ".gyaruinthemix-update.json"
        self.retry = retry
        # Ignore shell-level Compose overrides; use the installed file and .env.
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith("COMPOSE_") and not k.startswith("GYARUINTHEMIX_")
                    and k not in ("CHECKOUT_MODE", "DOCKER_HOST", "DOCKER_CONTEXT")}
        self.compose_args = ["compose", "--project-directory", str(self.directory),
                             "--env-file", str(self.directory / ".env"),
                             "-f", str(self.directory / "docker-compose.yml")]

    def docker(self, *args):
        result = subprocess.run(["docker", *args], cwd=self.directory, env=self.env,
                                text=True, capture_output=True, check=False, timeout=300)
        if result.returncode:
            # Docker/Compose output can include local configuration; do not log it.
            raise UpdateError(f"Docker {args[0]} failed; inspect the host locally.")
        return result.stdout

    def compose(self, *args, images=None):
        command = list(self.compose_args)
        if images is None:
            return self.docker(*command, *args)
        # JSON is valid YAML. Immutable local IDs prevent a moving :main tag race.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", dir=self.directory) as file:
            json.dump({"services": {name: {"image": image} for name, image in images.items()}}, file)
            file.flush()
            return self.docker(*command, "-f", file.name, *args)

    def save(self, state):
        with tempfile.NamedTemporaryFile(mode="w", dir=self.directory, delete=False) as file:
            json.dump(state, file, sort_keys=True)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
            temporary = file.name
        os.replace(temporary, self.state_path)

    def activate(self, images):
        self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never",
                     "--wait", "--wait-timeout", "120", *images, images=images)

    def run(self):
        context = json.loads(self.docker("context", "inspect"))[0]
        if not context["Endpoints"]["docker"]["Host"].startswith("unix://"):
            raise UpdateError("Use a local Docker context on the bouncer host.")
        if self.docker("info", "--format", "{{.Architecture}}").strip() not in ("x86_64", "amd64"):
            raise UpdateError("Published images currently require an amd64 Docker host; no containers were changed.")
        config = json.loads(self.compose("config", "--format", "json"))
        web = config["services"][WEB]
        mode = web.get("build", {}).get("args", {}).get("CHECKOUT_MODE", "payment_links")
        if mode not in ("payment_links", "api"):
            raise UpdateError("Unsupported CHECKOUT_MODE.")
        if mode == "api":
            self.compose_args += ["--profile", "checkout-api"]
            config = json.loads(self.compose("config", "--format", "json"))
        services = [WEB, API] if mode == "api" else [WEB]
        expected = {WEB: REGISTRY + ("web-api" if mode == "api" else "web") + ":main"}
        if mode == "api":
            expected[API] = REGISTRY + "api:main"
        for name in services:
            if config["services"][name]["image"] != expected[name]:
                raise UpdateError("Auto-update requires the documented matching GHCR :main images; pause the timer for a pinned release.")
        # Do not silently remove or leave an API behind during a mode migration.
        if mode == "payment_links":
            running = self.compose("ps", "--services", "--status", "running").split()
            if API in running:
                raise UpdateError("An API is still running. Finish the documented mode migration first.")
        state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        if state.get("pending"):
            previous = state.get("previous", {})
            if set(previous) != set(services):
                raise UpdateError("Interrupted update has a different mode; restore its original configuration before recovery.")
            self.activate(previous)
            state["rejected"] = state.pop("pending")
            self.save(state)
            print("Recovered the previous images after an interrupted update.")
        previous = {}
        for name in services:
            identifier = self.compose("ps", "-q", name).strip()
            if not identifier or "\n" in identifier:
                raise UpdateError("Start one healthy instance of each website service before enabling updates.")
            container = json.loads(self.docker("inspect", identifier))[0]
            if not container.get("State", {}).get("Running") or container["State"].get("Health", {}).get("Status") != "healthy":
                raise UpdateError("Each website service must be running and healthy before it can be a rollback baseline.")
            previous[name] = container["Image"]
        images = {}
        revisions = set()
        for name in services:
            self.docker("pull", expected[name])
            image = json.loads(self.docker("image", "inspect", expected[name]))[0]
            labels = image["Config"].get("Labels") or {}
            revision = labels.get("org.opencontainers.image.revision", "")
            if labels.get("org.opencontainers.image.source") != SOURCE or not re.fullmatch(r"[0-9a-f]{40}", revision):
                raise UpdateError("Image source/revision labels do not match the trusted release pipeline.")
            if name == WEB and labels.get("io.gyaruinthemix.checkout-mode") != mode:
                raise UpdateError("Web image checkout mode does not match the host configuration.")
            images[name] = image["Id"]
            revisions.add(revision)
        if len(revisions) != 1:
            raise UpdateError("Image publication is incomplete; retry after the same revision is available for both services.")
        if images == previous:
            print("Website already uses the current release.")
            return
        if images == state.get("rejected") and not self.retry:
            raise UpdateError("This release previously failed health checks; waiting for a new release (or an operator --retry).")
        self.save({"previous": previous, "pending": images})
        try:
            self.activate(images)
        except (UpdateError, subprocess.TimeoutExpired):
            # Leave pending recorded if rollback also fails: next run retries recovery.
            self.activate(previous)
            self.save({"previous": previous, "rejected": images})
            raise UpdateError("New website health checks failed. Previous images restored; this release is blocked.") from None
        self.save({"previous": previous, "current": images, "revision": revisions.pop()})
        print("Website updated and healthy; existing proxy, companion, ZNC and Limnoria were not reconciled.")


SHARED_SERVICES = ("proxy", "letsencrypt-companion", "znc", "limnoria")
SHARED_REGISTRY = {"letsencrypt-companion": "jrcs/letsencrypt-nginx-proxy-companion",
                   "limnoria": "ghcr.io/linuxserver/limnoria"}
SHARED_BUILDS = {"proxy": "proxy", "znc": "znc-docker/full"}


class SharedUpdater(Updater):
    """Explicit manual shared-service updates, with startup checks (not end-to-end health)."""

    def __init__(self, directory, retry=False):
        super().__init__(directory, retry=retry)
        self.state_path = self.directory / ".bouncer-shared-update.json"
        self.grace_seconds = 15

    def validate_config(self, config, names=SHARED_SERVICES):
        for name in names:
            service = config.get("services", {}).get(name, {})
            if name in SHARED_REGISTRY:
                expected = SHARED_REGISTRY[name]
                if service.get("image") not in (expected, expected + ":latest") or service.get("build"):
                    raise UpdateError(f"Review the changed image/build definition for {name} before shared updates.")
            else:
                build = service.get("build") or {}
                if not isinstance(build, dict):
                    raise UpdateError(f"Missing local build definition for {name}.")
                context = Path(build.get("context", "")).resolve()
                if context != self.directory / SHARED_BUILDS[name] or build.get("dockerfile", "Dockerfile") != "Dockerfile":
                    raise UpdateError(f"Review the changed build location for {name} before shared updates.")
                # Local Dockerfiles and copied files remain operator-owned inputs: review
                # edits before running this manual mode. Do not accept extra build
                # secrets, remote contexts, targets or network/privilege options.
                if service.get("image") or set(build) - {"context", "dockerfile"}:
                    raise UpdateError(f"Review the changed build definition for {name} before shared updates.")

    def container(self, name, expected=None):
        identifier = self.compose("ps", "--all", "-q", name).strip()
        if not identifier or "\n" in identifier:
            raise UpdateError(f"Shared update needs exactly one existing {name} container.")
        container = json.loads(self.docker("inspect", identifier))[0]
        state = container.get("State", {})
        if not state.get("Running") or state.get("Restarting") or state.get("Dead"):
            raise UpdateError(f"{name} is not stably running; investigate before updating.")
        health = state.get("Health", {}).get("Status")
        if health is not None and health != "healthy":
            raise UpdateError(f"{name} has not passed its Docker healthcheck.")
        if expected is not None and container.get("Image") != expected:
            raise UpdateError(f"{name} is running an unexpected image; investigate the concurrent change.")
        return identifier, container

    def probe(self, name):
        if name == "proxy":
            self.compose("exec", "-T", "--interactive=false", name, "nginx", "-t")
        elif name == "znc":
            # The established listener is TLS on 33313. Test the actual mapped host
            # listener, without credentials or messages sent into an IRC network.
            service = self.config["services"][name]
            ports = [p for p in service.get("ports", [])
                     if isinstance(p, dict) and p.get("target") == 33313 and p.get("protocol", "tcp") == "tcp"]
            if len(ports) != 1:
                raise UpdateError("ZNC needs the reviewed TLS listener mapping for startup verification.")
            port = ports[0]
            host = port.get("host_ip", "0.0.0.0")
            if host in ("0.0.0.0", ""):
                host = "127.0.0.1"
            elif host == "::":
                host = "::1"
            # This is a local TLS-handshake liveness check, not PKI validation.
            # Public certificate/hostname validation remains an operator check.
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            try:
                with socket.create_connection((host, int(port["published"])), timeout=5) as connection:
                    with context.wrap_socket(connection) as tls:
                        if not tls.getpeercert(binary_form=True):
                            raise UpdateError("ZNC TLS listener did not present a certificate.")
            except (OSError, ValueError) as error:
                raise UpdateError("ZNC local TLS startup probe failed.") from error

    def verify_startup(self, name, expected):
        identifier, container = self.container(name, expected)
        restart_count = container.get("RestartCount", 0)

        def check_container():
            current_id, current = self.container(name, expected)
            if current_id != identifier or current.get("RestartCount", 0) != restart_count:
                raise UpdateError(f"{name} restarted during startup verification.")

        # ZNC compiles local modules before opening its listener. Running alone
        # must not trigger an immediate rollback during this normal startup phase.
        ready_deadline = time.monotonic() + 120
        while True:
            check_container()
            try:
                self.probe(name)
                break
            except UpdateError:
                if time.monotonic() >= ready_deadline:
                    raise
                time.sleep(2)
        deadline = time.monotonic() + self.grace_seconds
        while time.monotonic() < deadline:
            time.sleep(min(2, max(0, deadline - time.monotonic())))
            check_container()
        self.probe(name)

    def shared_activate(self, name, image):
        self.activate({name: image})
        self.verify_startup(name, image)

    def read_state(self):
        state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        if not isinstance(state, dict) or set(state) - set(SHARED_SERVICES):
            raise UpdateError("Shared recovery state is invalid; investigate locally.")
        for record in state.values():
            if not isinstance(record, dict) or set(record) - {"previous", "pending", "current", "rejected"}:
                raise UpdateError("Shared recovery state is invalid; investigate locally.")
            for image in record.values():
                if not isinstance(image, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
                    raise UpdateError("Shared recovery state contains an invalid image ID.")
            if record.get("pending") and not record.get("previous"):
                raise UpdateError("Shared recovery state is missing its previous image.")
        return state

    def recover(self, state):
        for name in SHARED_SERVICES:
            record = state.get(name, {})
            if record.get("pending"):
                self.shared_activate(name, record["previous"])
                record["rejected"] = record.pop("pending")
                self.save(state)
                print(f"Recovered the previous {name} image after an interrupted shared update.")

    def prepare(self):
        candidates = {}
        namespace = hashlib.sha256(str(self.directory).encode()).hexdigest()[:12]
        for name in SHARED_SERVICES:
            if name in SHARED_REGISTRY:
                reference = self.config["services"][name]["image"]
                self.docker("pull", reference)
            else:
                reference = f"bouncer-updater/{namespace}-{name}:prepared"
                self.compose("build", "--pull", name, images={name: reference})
            image = json.loads(self.docker("image", "inspect", reference))[0]
            identifier = image.get("Id", "")
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", identifier):
                raise UpdateError(f"Could not identify the prepared {name} image.")
            candidates[name] = identifier
        return candidates

    def run(self):
        context = json.loads(self.docker("context", "inspect"))[0]
        if not context["Endpoints"]["docker"]["Host"].startswith("unix://"):
            raise UpdateError("Use a local Docker context on the bouncer host.")
        self.config = json.loads(self.compose("config", "--format", "json"))
        self.validate_config(self.config)
        state = self.read_state()
        self.recover(state)
        baselines = {name: self.container(name) for name in SHARED_SERVICES}
        previous = {name: value[1]["Image"] for name, value in baselines.items()}
        for name in SHARED_SERVICES:
            self.probe(name)
        candidates = self.prepare()
        for name in SHARED_SERVICES:
            if candidates[name] == previous[name]:
                print(f"{name}: image unchanged; container left running.")
                continue
            if candidates[name] == state.get(name, {}).get("rejected") and not self.retry:
                raise UpdateError(f"{name} previously failed startup checks; investigate before --retry.")
        for name in SHARED_SERVICES:
            if candidates[name] == previous[name]:
                continue
            # Fail before activation if another operator changed the baseline.
            identifier, current = self.container(name, previous[name])
            baseline_id, baseline = baselines[name]
            if identifier != baseline_id or current.get("RestartCount", 0) != baseline.get("RestartCount", 0) or current.get("State", {}).get("StartedAt") != baseline.get("State", {}).get("StartedAt"):
                raise UpdateError(f"{name} changed while images were prepared; rerun after investigating.")
            state[name] = {"previous": previous[name], "pending": candidates[name]}
            self.save(state)
            try:
                self.shared_activate(name, candidates[name])
            except (UpdateError, subprocess.TimeoutExpired):
                # Failed rollback remains pending so the next shared invocation retries it.
                self.shared_activate(name, previous[name])
                state[name] = {"previous": previous[name], "rejected": candidates[name]}
                self.save(state)
                raise UpdateError(f"{name} failed startup verification; previous image restored.") from None
            state[name] = {"previous": previous[name], "current": candidates[name]}
            self.save(state)
            print(f"{name}: updated; startup checks passed. Verify real client behavior manually.")
        print("Shared updates finished. No full-stack teardown, dependency recreation or pruning was performed.")


# Only fixed commands and validated hostnames enter this helper. Keys/certificates
# stay in the existing mounted data; no certificate contents enter updater output.
CERTIFICATE_SCRIPT = r'''
set -eu
umask 077
action=$1
domain=$2
live=/znc-data/znc.pem
next=/znc-data/.znc.pem.updater-new
backup=/znc-data/.znc.pem.updater-old
case "$action" in
stage)
    test -f "$live"
    test ! -L "$live"
    test ! -L "$next"
    test ! -L "$backup"
    mode=$(stat -c '%a' "$live")
    case "$mode" in 600|640) ;; *) exit 3 ;; esac
    work=$(mktemp -d /znc-data/.znc-cert.XXXXXX)
    trap 'rm -rf "$work"' EXIT HUP INT TERM
    source=/etc/nginx/certs/$domain
    openssl pkey -in "$source/key.pem" -passin pass: -check -noout >/dev/null 2>&1
    openssl x509 -in "$source/fullchain.pem" -out "$work/leaf.pem"
    openssl x509 -in "$work/leaf.pem" -checkhost "$domain" -noout >/dev/null 2>&1
    openssl verify -purpose sslserver -untrusted "$source/fullchain.pem" "$work/leaf.pem" >/dev/null 2>&1
    openssl pkey -in "$source/key.pem" -passin pass: -pubout > "$work/key.pub"
    openssl x509 -in "$work/leaf.pem" -pubkey -noout > "$work/cert.pub"
    cmp -s "$work/key.pub" "$work/cert.pub"
    cat "$source/key.pem" "$source/fullchain.pem" > "$work/combined.pem"
    # Revalidate the staged bytes, guarding against concurrent renewal.
    openssl pkey -in "$work/combined.pem" -passin pass: -pubout > "$work/combined.pub"
    openssl x509 -in "$work/combined.pem" -pubkey -noout > "$work/combined-cert.pub"
    cmp -s "$work/combined.pub" "$work/combined-cert.pub"
    openssl x509 -in "$work/combined.pem" -checkhost "$domain" -noout >/dev/null 2>&1
    openssl x509 -in "$work/combined.pem" -out "$work/staged-leaf.pem"
    openssl verify -purpose sslserver -untrusted "$work/combined.pem" "$work/staged-leaf.pem" >/dev/null 2>&1
    rm -f "$next" "$backup"
    if cmp -s "$work/combined.pem" "$live"; then
        echo unchanged
        exit 0
    fi
    chown "$(stat -c '%u:%g' "$live")" "$work/combined.pem"
    chmod "$mode" "$work/combined.pem"
    mv -f "$work/combined.pem" "$next"
    echo changed
    ;;
commit)
    test -f "$next"
    test ! -L "$next"
    test -f "$live"
    test ! -L "$live"
    test ! -L "$backup"
    work=$(mktemp -d /znc-data/.znc-cert.XXXXXX)
    trap 'rm -rf "$work"' EXIT HUP INT TERM
    cp -p "$live" "$work/old.pem"
    mv -f "$work/old.pem" "$backup"
    mv -f "$next" "$live"
    ;;
restore)
    test ! -L "$backup"
    test ! -L "$live"
    if test -f "$backup"; then
        work=$(mktemp -d /znc-data/.znc-cert.XXXXXX)
        trap 'rm -rf "$work"' EXIT HUP INT TERM
        cp -p "$backup" "$work/restored.pem"
        mv -f "$work/restored.pem" "$live"
    else
        # With no backup, staging must still exist: commit never replaced live.
        test -f "$next"
    test ! -L "$next"
    fi
    ;;
cleanup)
    rm -f "$next" "$backup"
    ;;
*) exit 2 ;;
esac
'''


class CertificateUpdater(SharedUpdater):
    def __init__(self, directory, retry=False):
        super().__init__(directory, retry=retry)
        self.state_path = self.directory / ".bouncer-znc-certificate-update.json"

    def helper(self, action, image, domain):
        identifier = self.compose("ps", "--all", "-q", "znc").strip()
        if not identifier or "\n" in identifier:
            raise UpdateError("Certificate recovery needs the existing ZNC container and its mounts.")
        return self.docker("run", "--rm", "--network", "none", "--user", "0",
                           "--volumes-from", identifier, "--entrypoint", "sh", image,
                           "-c", CERTIFICATE_SCRIPT, "certificate-update", action, domain).strip()

    def restart_znc(self, image):
        self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never",
                     "--force-recreate", "--wait", "--wait-timeout", "120", "znc",
                     images={"znc": image})
        self.verify_startup("znc", image)

    def run(self):
        context = json.loads(self.docker("context", "inspect"))[0]
        if not context["Endpoints"]["docker"]["Host"].startswith("unix://"):
            raise UpdateError("Use a local Docker context on the bouncer host.")
        self.config = json.loads(self.compose("config", "--format", "json"))
        self.validate_config(self.config, ("znc",))
        domain = self.config["services"]["znc"].get("environment", {}).get("LETSENCRYPT_HOST", "")
        if not isinstance(domain, str) or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?", domain) or ".." in domain:
            raise UpdateError("Certificate refresh requires one reviewed ZNC LETSENCRYPT_HOST hostname.")
        if self.state_path.exists():
            state = json.loads(self.state_path.read_text())
            if not isinstance(state, dict) or set(state) != {"image", "domain", "pending"} or state["domain"] != domain or state["pending"] is not True or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(state["image"])):
                raise UpdateError("Certificate recovery state does not match the current configuration.")
            self.helper("restore", state["image"], domain)
            self.restart_znc(state["image"])
            self.state_path.unlink()
            self.helper("cleanup", state["image"], domain)
            print("Recovered the previous ZNC certificate; inspect the cause before retrying refresh.")
            return
        baseline_id, baseline = self.container("znc")
        image = baseline["Image"]
        self.probe("znc")
        result = self.helper("stage", image, domain)
        if result == "unchanged":
            print("ZNC certificate unchanged; container left running.")
            return
        if result != "changed":
            raise UpdateError("Certificate staging returned an unexpected result; no restart was requested.")
        current_id, current = self.container("znc", image)
        if current_id != baseline_id or current.get("RestartCount", 0) != baseline.get("RestartCount", 0) or current.get("State", {}).get("StartedAt") != baseline.get("State", {}).get("StartedAt"):
            raise UpdateError("ZNC changed during certificate staging; rerun after investigating.")
        self.save({"image": image, "domain": domain, "pending": True})
        try:
            self.helper("commit", image, domain)
            self.restart_znc(image)
        except (UpdateError, subprocess.TimeoutExpired):
            # If rollback fails, retain the journal for the next --znc-cert run.
            self.helper("restore", image, domain)
            self.restart_znc(image)
            self.state_path.unlink()
            self.helper("cleanup", image, domain)
            raise UpdateError("Certificate startup verification failed; previous certificate restored.") from None
        self.state_path.unlink()
        self.helper("cleanup", image, domain)
        print("ZNC certificate refreshed and startup checks passed; verify your IRC client connection.")


def guard_pending(directory, mode):
    """Do not mix another workflow with a transaction needing explicit recovery."""
    paths = {"website": ".gyaruinthemix-update.json", "shared": ".bouncer-shared-update.json",
             "znc-cert": ".bouncer-znc-certificate-update.json"}
    for owner, filename in paths.items():
        if owner == mode:
            continue
        path = Path(directory) / filename
        if path.exists():
            state = json.loads(path.read_text())
            if not isinstance(state, dict):
                raise UpdateError("Updater state is invalid; inspect it before continuing.")
            pending = any(isinstance(v, dict) and v.get("pending") for v in state.values()) if owner == "shared" else state.get("pending")
            if pending:
                instruction = "without a mode flag" if owner == "website" else f"with --{owner}"
                raise UpdateError(f"An interrupted {owner} transaction needs recovery; run the updater {instruction} first.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default=str(Path.home() / "bouncer"))
    parser.add_argument("--retry", action="store_true", help="retry the last rejected image after operator investigation")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--shared", action="store_true", help="manually update only the four reviewed shared services; may briefly interrupt traffic")
    modes.add_argument("--znc-cert", action="store_true", help="validate/refresh only the ZNC certificate; restart ZNC only if changed")
    args = parser.parse_args()
    mode = "shared" if args.shared else "znc-cert" if args.znc_cert else "website"
    updater_class = SharedUpdater if args.shared else CertificateUpdater if args.znc_cert else Updater
    updater = updater_class(args.directory, retry=args.retry)
    os.umask(0o077)
    try:
        with (updater.directory / ".gyaruinthemix-update.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("Another bouncer update is already running.")
                return 0
            guard_pending(args.directory, mode)
            updater.run()
    except (UpdateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"Bouncer update stopped: {error if isinstance(error, UpdateError) else type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
