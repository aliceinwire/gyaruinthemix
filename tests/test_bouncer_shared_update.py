"""Offline shared updater tests: fake Docker and disposable local certificate fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("shared_bouncer_update", ROOT / "deploy/bouncer/update.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def image(number):
    return "sha256:" + format(number, "064x")


class FakeShared(module.SharedUpdater):
    def __init__(self, directory, **kwargs):
        super().__init__(directory, **kwargs)
        self.grace_seconds = 0
        self.current = {name: image(i + 1) for i, name in enumerate(module.SHARED_SERVICES)}
        self.desired = {name: image(i + 11) for i, name in enumerate(module.SHARED_SERVICES)}
        self.identifiers = {name: name for name in module.SHARED_SERVICES}
        self.calls = []
        self.probes = []
        self.activations = []
        self.fail_prepare = None
        self.fail_activate = set()
        self.concurrent = False
        self.restarting = False
        self.health = None
        self.config = {"services": {
            "proxy": {"build": {"context": str(self.directory / "proxy"), "dockerfile": "Dockerfile"}},
            "znc": {"build": {"context": str(self.directory / "znc-docker/full"), "dockerfile": "Dockerfile"},
                    "environment": {"LETSENCRYPT_HOST": "irc.example.test"},
                    "ports": [{"target": 33313, "published": "33313"}]},
            **{name: {"image": value} for name, value in module.SHARED_REGISTRY.items()},
        }}

    def docker(self, *args):
        self.calls.append(args)
        if args == ("context", "inspect"):
            return json.dumps([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
        if args[0] == "inspect":
            name = next(name for name, identifier in self.identifiers.items() if identifier == args[1])
            state = {"Running": True, "Restarting": self.restarting, "StartedAt": "today"}
            if self.health is not None:
                state["Health"] = {"Status": self.health}
            return json.dumps([{"Image": self.current[name], "State": state, "RestartCount": 0}])
        if args[0] == "pull":
            if self.fail_prepare == "pull":
                raise module.UpdateError("Pull failed")
            return ""
        if args[:2] == ("image", "inspect"):
            reference = args[2]
            name = next((name for name, value in module.SHARED_REGISTRY.items() if reference == value), None)
            if name is None:
                name = "proxy" if "-proxy:" in reference else "znc"
            if self.concurrent:
                self.identifiers["proxy"] = "replacement-same-image"
            return json.dumps([{"Id": self.desired[name]}])
        raise AssertionError(args)

    def compose(self, *args, images=None):
        self.calls.append(("compose", *args, images))
        if args[0] == "config":
            return json.dumps(self.config)
        if args[:3] == ("ps", "--all", "-q"):
            return self.identifiers[args[3]]
        if args[0] == "build":
            if self.fail_prepare == "build":
                raise module.UpdateError("Build failed")
            self.assert_candidate = images
            return ""
        if args[0] == "up":
            name, identifier = next(iter(images.items()))
            self.activations.append((args, dict(images)))
            if identifier in self.fail_activate:
                raise module.UpdateError("Startup failed")
            self.current[name] = identifier
            return ""
        raise AssertionError(args)

    def probe(self, name):
        self.probes.append(name)


class SharedTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.updater = FakeShared(self.temporary.name)

    def test_noop_builds_with_pull_but_never_recreates(self):
        u = self.updater
        u.desired = dict(u.current)
        u.run()
        self.assertEqual(u.activations, [])
        builds = [c for c in u.calls if c[:2] == ("compose", "build")]
        self.assertEqual([c[3] for c in builds], ["proxy", "znc"])
        self.assertTrue(all(c[2] == "--pull" for c in builds))
        self.assertEqual([c[1] for c in u.calls if c[0] == "pull"], list(module.SHARED_REGISTRY.values()))
        self.assertFalse(u.state_path.exists())

    def test_only_changed_service_is_activated_with_immutable_id(self):
        u = self.updater
        desired = u.desired["znc"]
        u.desired = dict(u.current)
        u.desired["znc"] = desired
        u.run()
        self.assertEqual(len(u.activations), 1)
        args, images = u.activations[0]
        self.assertEqual(images, {"znc": desired})
        for flag in ("--no-deps", "--no-build", "--wait"):
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("--pull") + 1], "never")
        self.assertNotIn(module.WEB, repr(u.calls))
        self.assertNotIn("down", repr(u.calls))

    def test_prepare_failure_never_changes_running_services(self):
        for failure in ("pull", "build"):
            with self.subTest(failure=failure):
                u = FakeShared(self.temporary.name)
                u.fail_prepare = failure
                with self.assertRaises(module.UpdateError):
                    u.run()
                self.assertEqual(u.activations, [])
                self.assertFalse(u.state_path.exists())

    def test_failure_rolls_back_only_failed_service_and_blocks_same_image(self):
        u = self.updater
        old = dict(u.current)
        u.fail_activate.add(u.desired["znc"])
        with self.assertRaisesRegex(module.UpdateError, "previous image restored"):
            u.run()
        self.assertEqual([next(iter(images)) for _, images in u.activations], ["proxy", "letsencrypt-companion", "znc", "znc"])
        self.assertEqual(u.current["proxy"], u.desired["proxy"])
        self.assertEqual(u.current["znc"], old["znc"])
        state = json.loads(u.state_path.read_text())
        self.assertEqual(state["znc"]["rejected"], u.desired["znc"])
        u.activations.clear()
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            u.run()
        self.assertEqual(u.activations, [])
        u.retry = True
        u.fail_activate.clear()
        u.run()
        self.assertEqual(u.current, u.desired)

    def test_failed_rollback_remains_pending_and_recovers_before_pull(self):
        u = self.updater
        u.fail_activate.update((u.current["proxy"], u.desired["proxy"]))
        with self.assertRaises(module.UpdateError):
            u.run()
        self.assertIn("pending", json.loads(u.state_path.read_text())["proxy"])
        u.fail_activate.clear()
        u.calls.clear()
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            u.run()
        operations = [c[1] if c[0] == "compose" else c[0] for c in u.calls]
        self.assertLess(operations.index("up"), operations.index("pull"))
        self.assertNotIn("pending", json.loads(u.state_path.read_text())["proxy"])

    def test_bad_state_or_configuration_stops_before_preparation(self):
        for name, change in (("proxy", {"build": {"context": "/other"}}),
                             ("proxy", {"build": {"context": str(self.updater.directory / "proxy"), "args": {"bad": "value"}}}),
                             ("limnoria", {"image": "unreviewed/image"})):
            u = FakeShared(self.temporary.name)
            u.config["services"][name] = change
            with self.assertRaises(module.UpdateError):
                u.run()
            self.assertEqual(u.activations, [])
            self.assertFalse(any(c[0] == "pull" for c in u.calls))
        u = self.updater
        u.save({"other-service": {"pending": image(1), "previous": image(2)}})
        with self.assertRaises(module.UpdateError):
            u.run()
        self.assertEqual(u.activations, [])

    def test_same_image_concurrent_recreation_is_detected(self):
        u = self.updater
        u.concurrent = True
        with self.assertRaisesRegex(module.UpdateError, "changed while"):
            u.run()
        self.assertEqual(u.activations, [])

    def test_existing_unhealthy_or_restarting_baseline_is_refused(self):
        for attribute, value in (("health", "unhealthy"), ("restarting", True)):
            u = FakeShared(self.temporary.name)
            setattr(u, attribute, value)
            with self.assertRaises(module.UpdateError):
                u.run()
            self.assertEqual(u.activations, [])

    def test_grace_window_detects_restart(self):
        u = self.updater
        u.grace_seconds = 2
        baseline = {"Image": image(1), "RestartCount": 0}
        restarted = {"Image": image(1), "RestartCount": 1}
        with patch.object(u, "container", side_effect=[("id", baseline), ("id", restarted)]), \
             patch.object(module.time, "monotonic", return_value=0), \
             patch.object(module.time, "sleep"):
            with self.assertRaisesRegex(module.UpdateError, "restarted"):
                u.verify_startup("proxy", image(1))

    def test_slow_module_compilation_waits_for_listener(self):
        u = self.updater
        with patch.object(u, "probe", side_effect=[module.UpdateError("not ready"), None, None]) as probe, \
             patch.object(module.time, "sleep") as sleep:
            u.verify_startup("znc", u.current["znc"])
        self.assertEqual(probe.call_count, 3)
        sleep.assert_called_once_with(2)

    def test_default_and_explicit_modes_dispatch_only_selected_workflow(self):
        for flag, expected in (([], "website"), (["--shared"], "shared"), (["--znc-cert"], "cert")):
            with patch.object(module.sys, "argv", ["update.py", "--directory", self.temporary.name, *flag]), \
                 patch.object(module.Updater, "run") as website, \
                 patch.object(module.SharedUpdater, "run") as shared, \
                 patch.object(module.CertificateUpdater, "run") as cert:
                self.assertEqual(module.main(), 0)
                self.assertEqual([website.call_count, shared.call_count, cert.call_count],
                                 [int(expected == name) for name in ("website", "shared", "cert")])

    def test_foreign_pending_transaction_blocks_other_modes(self):
        self.updater.save({"znc": {"pending": image(5), "previous": image(4)}})
        with self.assertRaisesRegex(module.UpdateError, "--shared"):
            module.guard_pending(self.temporary.name, "website")
        module.guard_pending(self.temporary.name, "shared")


class FakeCertificate(module.CertificateUpdater):
    def __init__(self, directory):
        super().__init__(directory)
        self.config = FakeShared(directory).config
        self.actions = []
        self.restarts = []
        self.result = "changed"
        self.fail_new = False
        self.fail_restore = False
        self.identifier = image(3)

    def docker(self, *args):
        if args == ("context", "inspect"):
            return json.dumps([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
        raise AssertionError(args)

    def compose(self, *args, images=None):
        if args[0] == "config":
            return json.dumps(self.config)
        raise AssertionError(args)

    def container(self, name, expected=None):
        return "znc-container", {"Image": self.identifier}

    def helper(self, action, image, domain):
        self.actions.append(action)
        if action == "cleanup":
            assert not self.state_path.exists(), "Cleanup must follow durable journal completion"
        if action == "restore" and self.fail_restore:
            raise module.UpdateError("restore failed")
        return self.result if action == "stage" else ""

    def probe(self, name):
        pass

    def restart_znc(self, image):
        self.restarts.append(image)
        if self.fail_new and len(self.restarts) == 1:
            raise module.UpdateError("probe failed")


class CertificateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.u = FakeCertificate(self.temporary.name)

    def test_unchanged_certificate_skips_restart_and_journal(self):
        self.u.result = "unchanged"
        self.u.run()
        self.assertEqual(self.u.actions, ["stage"])
        self.assertEqual(self.u.restarts, [])
        self.assertFalse(self.u.state_path.exists())

    def test_changed_certificate_commits_and_restarts_only_znc(self):
        self.u.run()
        self.assertEqual(self.u.actions, ["stage", "commit", "cleanup"])
        self.assertEqual(self.u.restarts, [self.u.identifier])
        self.assertFalse(self.u.state_path.exists())

    def test_failed_startup_restores_certificate_and_keeps_journal_if_rollback_fails(self):
        self.u.fail_new = True
        with self.assertRaisesRegex(module.UpdateError, "previous certificate restored"):
            self.u.run()
        self.assertEqual(self.u.actions, ["stage", "commit", "restore", "cleanup"])
        self.assertEqual(self.u.restarts, [self.u.identifier] * 2)
        self.assertFalse(self.u.state_path.exists())
        self.u.restarts.clear()
        self.u.fail_restore = True
        with self.assertRaisesRegex(module.UpdateError, "restore failed"):
            self.u.run()
        self.assertTrue(self.u.state_path.exists())
        self.u.fail_restore = False
        self.u.run()
        self.assertFalse(self.u.state_path.exists())

    def test_pending_certificate_recovers_without_new_staging(self):
        self.u.save({"image": self.u.identifier, "domain": "irc.example.test", "pending": True})
        self.u.run()
        self.assertEqual(self.u.actions, ["restore", "cleanup"])
        self.assertEqual(self.u.restarts, [self.u.identifier])

    def test_unsafe_hostname_is_refused(self):
        self.u.config["services"]["znc"]["environment"]["LETSENCRYPT_HOST"] = "../secret"
        with self.assertRaises(module.UpdateError):
            self.u.run()
        self.assertEqual(self.u.actions, [])

    def test_helper_is_offline_existing_image_with_no_startup_hook(self):
        u = module.CertificateUpdater(self.temporary.name)
        with patch.object(u, "compose", return_value="existing-znc"), patch.object(u, "docker", return_value="changed") as docker:
            self.assertEqual(u.helper("stage", image(3), "irc.example.test"), "changed")
        args = docker.call_args.args
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args[args.index("--entrypoint") + 1], "sh")
        self.assertEqual(args[args.index("--volumes-from") + 1], "existing-znc")
        self.assertIn(image(3), args)


class CertificateShellTests(unittest.TestCase):
    """Exercise actual shell/OpenSSL with ephemeral, local-only fixture certificates."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.source = self.root / "certs" / "irc.example.test"
        self.data.mkdir()
        self.source.mkdir(parents=True)
        self.script = module.CERTIFICATE_SCRIPT.replace("/znc-data", str(self.data)).replace("/etc/nginx/certs", str(self.root / "certs"))
        self.command("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(self.root / "ca.key"), "-out", str(self.root / "ca.pem"), "-subj", "/CN=Ephemeral Test CA", "-days", "1")
        self.command("openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", str(self.source / "key.pem"), "-out", str(self.root / "leaf.csr"), "-subj", "/CN=irc.example.test")
        (self.root / "extensions").write_text("subjectAltName=DNS:irc.example.test\nextendedKeyUsage=serverAuth\n")
        self.sign()
        self.live = self.data / "znc.pem"
        self.live.write_text("previous certificate fixture\n")
        self.live.chmod(0o640)

    def command(self, *args):
        result = subprocess.run(args, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, "Local certificate fixture command failed")
        return result

    def sign(self, days="1"):
        self.command("openssl", "x509", "-req", "-in", str(self.root / "leaf.csr"), "-CA", str(self.root / "ca.pem"), "-CAkey", str(self.root / "ca.key"), "-CAcreateserial", "-out", str(self.source / "fullchain.pem"), "-days", days, "-extfile", str(self.root / "extensions"))

    def helper(self, action, success=True, domain="irc.example.test"):
        result = subprocess.run(["sh", "-c", self.script, "fixture", action, domain],
                                env={**os.environ, "SSL_CERT_FILE": str(self.root / "ca.pem")},
                                capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, f"Certificate helper {action} failed")
        else:
            self.assertNotEqual(result.returncode, 0)
        # Never output private-key bytes, even in failing fixtures.
        self.assertNotIn("PRIVATE KEY", result.stdout + result.stderr)
        return result.stdout.strip()

    def test_stage_commit_restore_is_atomic_metadata_preserving_and_repeatable(self):
        original = self.live.read_bytes()
        self.assertEqual(self.helper("stage"), "changed")
        self.assertEqual(self.live.read_bytes(), original)
        self.helper("commit")
        self.assertNotEqual(self.live.read_bytes(), original)
        self.assertEqual(self.live.stat().st_mode & 0o777, 0o640)
        self.helper("restore")
        self.helper("restore")
        self.assertEqual(self.live.read_bytes(), original)
        self.assertEqual(self.live.stat().st_mode & 0o777, 0o640)
        self.helper("cleanup")

    def test_unchanged_certificate_and_failed_validation_never_touch_live(self):
        self.helper("stage")
        self.helper("commit")
        self.helper("cleanup")
        self.assertEqual(self.helper("stage"), "unchanged")
        previous = self.live.read_bytes()
        (self.source / "key.pem").write_bytes((self.root / "ca.key").read_bytes())
        self.helper("stage", success=False)
        self.assertEqual(self.live.read_bytes(), previous)

    def test_expired_and_wrong_hostname_certificates_are_rejected(self):
        original = self.live.read_bytes()
        original_script = self.script
        future = int(module.time.time()) + 172800
        self.script = self.script.replace("openssl verify", f"openssl verify -attime {future}")
        self.helper("stage", success=False)
        self.assertEqual(self.live.read_bytes(), original)
        self.script = original_script
        alternate = self.source.parent / "another.example.test"
        alternate.mkdir()
        for name in ("key.pem", "fullchain.pem"):
            (alternate / name).write_bytes((self.source / name).read_bytes())
        self.helper("stage", success=False, domain="another.example.test")
        self.assertEqual(self.live.read_bytes(), original)

    def test_dangling_staged_symlink_and_symlinked_backup_fail_closed(self):
        original = self.live.read_bytes()
        next_path = self.data / ".znc.pem.updater-new"
        next_path.symlink_to(self.data / "missing.pem")
        self.helper("commit", success=False)
        self.assertEqual(self.live.read_bytes(), original)
        self.assertFalse(self.live.is_symlink())
        next_path.unlink()
        backup = self.data / ".znc.pem.updater-old"
        backup.symlink_to(self.live)
        self.helper("restore", success=False)
        self.assertFalse(self.live.is_symlink())
        self.assertEqual(self.live.read_bytes(), original)

    def test_bad_modes_symlinks_and_missing_recovery_backup_are_refused(self):
        self.live.chmod(0o644)
        self.helper("stage", success=False)
        self.live.chmod(0o600)
        self.helper("restore", success=False)
        self.helper("stage")
        # Interrupted before commit is safely recoverable: staged file still exists.
        self.helper("restore")
        self.helper("cleanup")
        target = self.data / "other.pem"
        self.live.rename(target)
        self.live.symlink_to(target)
        self.helper("stage", success=False)


if __name__ == "__main__":
    unittest.main()
