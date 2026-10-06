"""Offline updater tests. No Docker daemon, credentials, network or deployment."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bouncer_update", ROOT / "deploy/bouncer/update.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeUpdater(module.Updater):
    def __init__(self, directory, mode="payment_links", **kwargs):
        super().__init__(directory, **kwargs)
        self.mode = mode
        self.services = [module.WEB, module.API] if mode == "api" else [module.WEB]
        self.current = {name: "sha256:" + str(i + 1) * 64 for i, name in enumerate(self.services)}
        self.desired = {name: "sha256:" + str(i + 3) * 64 for i, name in enumerate(self.services)}
        self.activations = []
        self.pulls = []
        self.fail_new = False
        self.fail_rollback = False
        self.fail_pull = False
        self.source = module.SOURCE
        self.revisions = {name: "a" * 40 for name in self.services}
        self.image_mode = mode
        self.image_override = None
        self.extra_api = False
        self.remote = False
        self.healthy = True
        self.architecture = "amd64"
        self.config = {"services": {
            module.WEB: {"image": module.REGISTRY + ("web-api" if mode == "api" else "web") + ":main",
                         "build": {"args": {"CHECKOUT_MODE": mode}}},
            module.API: {"image": module.REGISTRY + "api:main"},
        }}

    def docker(self, *args):
        if args == ("context", "inspect"):
            return json.dumps([{"Endpoints": {"docker": {"Host": "ssh://other" if self.remote else "unix:///var/run/docker.sock"}}}])
        if args[0] == "info":
            return self.architecture
        if args[0] == "pull":
            self.pulls.append(args[1])
            if self.fail_pull:
                raise module.UpdateError("Registry unavailable")
            return ""
        if args[0] == "inspect":
            return json.dumps([{"Image": self.current[args[1]], "State": {"Running": True, "Health": {"Status": "healthy" if self.healthy else "unhealthy"}}}])
        if args[:2] == ("image", "inspect"):
            name = module.API if args[2] == module.REGISTRY + "api:main" else module.WEB
            return json.dumps([{"Id": self.desired[name], "Config": {"Labels": {
                "org.opencontainers.image.source": self.source,
                "org.opencontainers.image.revision": self.revisions[name],
                "io.gyaruinthemix.checkout-mode": self.image_mode,
            }}}])
        raise AssertionError(args)

    def compose(self, *args, images=None):
        if args[0] == "config":
            if self.image_override:
                self.config["services"][module.WEB]["image"] = self.image_override
            return json.dumps(self.config)
        if args[:3] == ("ps", "-q", module.WEB) or args[:3] == ("ps", "-q", module.API):
            return args[2] if args[2] in self.current else ""
        if args[0] == "ps":
            return "\n".join(self.services + ([module.API] if self.extra_api else []))
        if args[0] == "up":
            self.activations.append((args, images.copy()))
            if self.fail_new and images == self.desired:
                raise module.UpdateError("Health failed")
            if self.fail_rollback and images == self.current:
                raise module.UpdateError("Rollback failed")
            return ""
        raise AssertionError(args)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def updater(self, **kwargs):
        return FakeUpdater(self.directory.name, **kwargs)

    def test_static_scopes_immutable_images_and_no_build(self):
        updater = self.updater()
        updater.run()
        self.assertEqual(len(updater.activations), 1)
        args, images = updater.activations[0]
        self.assertEqual(set(images), {module.WEB})
        self.assertEqual(images, updater.desired)
        for flag in ["--no-deps", "--no-build", "--wait"]:
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("--pull") + 1], "never")
        self.assertEqual(json.loads(updater.state_path.read_text())["previous"], updater.current)

    def test_api_pair_updates_together(self):
        updater = self.updater(mode="api")
        updater.run()
        self.assertEqual(set(updater.activations[0][1]), {module.WEB, module.API})
        self.assertIn("checkout-api", updater.compose_args)

    def test_already_current_does_not_recreate(self):
        updater = self.updater()
        updater.desired = updater.current.copy()
        updater.run()
        self.assertEqual(updater.activations, [])

    def test_mixed_revision_does_not_update_either_service(self):
        updater = self.updater(mode="api")
        updater.revisions[module.API] = "b" * 40
        with self.assertRaisesRegex(module.UpdateError, "incomplete"):
            updater.run()
        self.assertEqual(updater.activations, [])

    def test_bad_source_mode_revision_or_reference_fails_closed(self):
        for attribute, value in [("source", "https://github.com/untrusted/repo"),
                                 ("image_mode", "api"), ("image_override", "other/image:main")]:
            with self.subTest(attribute=attribute):
                updater = self.updater()
                setattr(updater, attribute, value)
                with self.assertRaises(module.UpdateError):
                    updater.run()
                self.assertEqual(updater.activations, [])
        updater = self.updater()
        updater.revisions[module.WEB] = "pull-request"
        with self.assertRaises(module.UpdateError):
            updater.run()
        self.assertEqual(updater.activations, [])

    def test_pull_failure_preserves_running_service(self):
        updater = self.updater()
        updater.fail_pull = True
        with self.assertRaises(module.UpdateError):
            updater.run()
        self.assertEqual(updater.activations, [])

    def test_health_failure_rolls_back_and_blocks_retry(self):
        updater = self.updater()
        updater.fail_new = True
        with self.assertRaisesRegex(module.UpdateError, "Previous images restored"):
            updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.desired, updater.current])
        self.assertEqual(json.loads(updater.state_path.read_text())["rejected"], updater.desired)
        updater.activations.clear()
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            updater.run()
        self.assertEqual(updater.activations, [])
        updater.retry = True
        updater.fail_new = False
        updater.run()
        self.assertEqual(len(updater.activations), 1)

    def test_failed_rollback_keeps_recovery_state(self):
        updater = self.updater()
        updater.fail_new = updater.fail_rollback = True
        with self.assertRaisesRegex(module.UpdateError, "Rollback failed"):
            updater.run()
        state = json.loads(updater.state_path.read_text())
        self.assertEqual(state["pending"], updater.desired)
        self.assertEqual(state["previous"], updater.current)

    def test_interrupted_update_recovers_before_new_attempt(self):
        updater = self.updater()
        updater.save({"previous": updater.current, "pending": updater.desired})
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.current])
        self.assertNotIn("pending", json.loads(updater.state_path.read_text()))

    def test_mode_migration_missing_container_and_remote_context_stop(self):
        for attribute, value in [("extra_api", True), ("current", {}), ("remote", True), ("healthy", False), ("architecture", "arm64")]:
            with self.subTest(attribute=attribute):
                updater = self.updater()
                setattr(updater, attribute, value)
                with self.assertRaises(module.UpdateError):
                    updater.run()
                self.assertEqual(updater.activations, [])

    def test_environment_does_not_accept_inherited_compose_overrides(self):
        with patch.dict("os.environ", {"COMPOSE_FILE": "/tmp/untrusted.yml", "GYARUINTHEMIX_WEB_IMAGE": "other", "DOCKER_HOST": "ssh://other"}):
            updater = self.updater()
            self.assertNotIn("COMPOSE_FILE", updater.env)
            self.assertNotIn("GYARUINTHEMIX_WEB_IMAGE", updater.env)
            self.assertNotIn("DOCKER_HOST", updater.env)

    def test_another_process_lock_exits_without_docker(self):
        with patch.object(module.sys, "argv", ["update.py", "--directory", self.directory.name]), \
             patch.object(module.fcntl, "flock", side_effect=BlockingIOError), \
             patch.object(module.Updater, "run") as run:
            self.assertEqual(module.main(), 0)
            run.assert_not_called()

    def test_compose_override_pins_only_selected_service_ids(self):
        updater = module.Updater(self.directory.name)
        images = {module.WEB: "sha256:" + "a" * 64}
        def inspect_call(*args):
            files = [args[i + 1] for i, value in enumerate(args) if value == "-f"]
            self.assertEqual(json.loads(Path(files[-1]).read_text()), {"services": {module.WEB: {"image": images[module.WEB]}}})
            return "ok"
        with patch.object(updater, "docker", side_effect=inspect_call):
            self.assertEqual(updater.compose("up", images=images), "ok")
        self.assertEqual(list(Path(self.directory.name).glob("*.json")), [])


class DeploymentContractTests(unittest.TestCase):
    def test_original_bouncer_services_are_byte_preserved(self):
        actual = (ROOT / "deploy/bouncer/docker-compose.yml").read_text()
        original = (ROOT / "tests/fixtures/bouncer.original.yml").read_text()
        self.assertEqual(actual[actual.index("services:"):actual.index("  # Website services.")].rstrip(),
                         original[:original.index("volumes:\n  certs:")].rstrip())

    def test_only_current_deployment_and_trusted_publication(self):
        self.assertEqual(list(ROOT.glob("compose*.yaml")), [])
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        self.assertNotIn("pull_request_target", workflow)
        self.assertNotIn("workflow_run", workflow)
        self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'aliceinwire/gyaruinthemix'", workflow)
        self.assertIn("needs: [source, secrets, containers, browser]", workflow)
        self.assertEqual(workflow.count("packages: write"), 1)
        self.assertIn("CI_PAYMENT_LINK_FIXTURE: 'false'", workflow)
        publish = (ROOT / "scripts/publish-images.sh").read_text()
        self.assertNotIn("docker build", publish)
        self.assertIn('docker push "$destination:sha-$GITHUB_SHA"', publish)
        self.assertIn('docker push "$destination:main"', publish)


if __name__ == "__main__":
    unittest.main()
