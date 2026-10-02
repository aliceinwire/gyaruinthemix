#!/usr/bin/env python3
"""Pull tested website images; never build or reconcile shared bouncer services."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

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
            raise UpdateError(f"Docker {args[0]} failed; inspect the website locally.")
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default=str(Path.home() / "bouncer"))
    parser.add_argument("--retry", action="store_true", help="retry the last rejected image after operator investigation")
    args = parser.parse_args()
    updater = Updater(args.directory, retry=args.retry)
    os.umask(0o077)
    try:
        with (updater.directory / ".gyaruinthemix-update.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("Another website update is already running.")
                return 0
            updater.run()
    except (UpdateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(f"Website update stopped: {error if isinstance(error, UpdateError) else type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
