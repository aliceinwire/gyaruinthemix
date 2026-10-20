"""Offline daemon-mocked audio lifecycle and confinement tests; no host deployment."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_bouncer_update import FakeUpdater, module, ROOT


class AudioUpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def updater(self, **kwargs):
        return FakeUpdater(self.directory, **kwargs)

    def test_default_off_never_packages_reads_media_or_pulls_audio(self):
        updater = self.updater()
        with patch.object(updater, "validate_audio", side_effect=AssertionError("audio accessed")), \
             patch.object(updater, "package_audio", side_effect=AssertionError("media accessed")):
            updater.run()
        self.assertEqual(updater.pulls, [module.REGISTRY + "web:main"])
        self.assertNotIn("game-audio", updater.compose_args)

    def test_shell_cannot_enable_audio_or_change_media_key_or_image(self):
        overrides = {"GAME_AUDIO_ENABLED": "true", "GAME_AUDIO_SIGNING_KEY_FILE": "/other/key",
                     "AUDIO_MEDIA_ROOT": "/other", "GYARUINTHEMIX_GAME_AUDIO_IMAGE": "other/image",
                     "GAME_AUDIO_LIBRARY_DIR": "/other", "COMPOSE_PROFILES": "game-audio"}
        with patch.dict(os.environ, overrides):
            updater = self.updater()
            updater.run()
        self.assertTrue(set(overrides).isdisjoint(updater.env))
        self.assertEqual(updater.packages, 0)

    def test_audio_is_pinned_pulled_activated_and_health_checked_with_each_checkout_mode(self):
        for mode in ("payment_links", "api"):
            with self.subTest(mode=mode):
                updater = self.updater(mode=mode, audio=True)
                updater.run()
                self.assertIn("game-audio", updater.compose_args)
                self.assertIn(module.REGISTRY + "game-audio:main", updater.pulls)
                self.assertEqual(updater.packages, 1)
                args, images = updater.activations[0]
                self.assertEqual(images, updater.desired)
                self.assertEqual(set(images), set(updater.services))
                for value in ("--no-deps", "--no-build", "--wait"):
                    self.assertIn(value, args)
                self.assertTrue(set(module.SHARED_SERVICES).isdisjoint(images))

    def test_unchanged_release_still_discovers_dropped_files_without_recreating_containers(self):
        updater = self.updater(audio=True)
        updater.desired = updater.current.copy()
        updater.run()
        self.assertEqual(updater.packages, 1)
        self.assertEqual(updater.activations, [])

    def test_incomplete_audio_publication_never_packages_or_activates(self):
        updater = self.updater(mode="api", audio=True)
        updater.revisions[module.AUDIO] = "b" * 40
        with self.assertRaisesRegex(module.UpdateError, "incomplete"):
            updater.run()
        self.assertEqual(updater.packages, 0)
        self.assertEqual(updater.activations, [])

    def test_missing_or_unhealthy_audio_requires_explicit_first_activation(self):
        updater = self.updater(audio=True)
        updater.current.pop(module.AUDIO)
        with self.assertRaisesRegex(module.UpdateError, "Start one healthy"):
            updater.run()
        self.assertEqual(updater.packages, 0)
        self.assertEqual(updater.activations, [])

    def test_disabled_audio_is_not_silently_left_running(self):
        updater = self.updater()
        updater.extra_audio = True
        with self.assertRaisesRegex(module.UpdateError, "deactivation"):
            updater.run()
        self.assertEqual(updater.pulls, [])

    def test_invalid_opt_in_values_fail_closed(self):
        for value in (True, "TRUE", "1", "", "yes"):
            updater = self.updater()
            updater.config["services"][module.WEB]["environment"]["GAME_AUDIO_ENABLED"] = value
            with self.assertRaisesRegex(module.UpdateError, "exactly true or false"):
                updater.run()
            self.assertEqual(updater.pulls, [])

    def test_packaging_failure_never_changes_running_images_or_creates_pending_state(self):
        updater = self.updater(audio=True)
        updater.fail_package = True
        with self.assertRaisesRegex(module.UpdateError, "Packaging failed"):
            updater.run()
        self.assertEqual(updater.activations, [])
        self.assertFalse(updater.state_path.exists())

    def test_concurrent_change_during_packaging_refuses_stale_rollback_baseline(self):
        updater = self.updater(audio=True)
        updater.concurrent = True
        with self.assertRaisesRegex(module.UpdateError, "changed while"):
            updater.run()
        self.assertEqual(updater.activations, [])
        self.assertFalse(updater.state_path.exists())

    def test_audio_rollback_and_interrupted_recovery_preserve_the_exact_service_scope(self):
        updater = self.updater(mode="api", audio=True)
        updater.fail_new = updater.fail_rollback = True
        with self.assertRaisesRegex(module.UpdateError, "Rollback failed"):
            updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.desired, updater.current])
        self.assertEqual(json.loads(updater.state_path.read_text())["pending"], updater.desired)
        updater.activations.clear()
        updater.fail_new = updater.fail_rollback = False
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.current])
        self.assertNotIn("pending", json.loads(updater.state_path.read_text()))

    def test_pending_recovery_precedes_packaging_specific_capability_failure(self):
        updater = self.updater(audio=True)
        updater.save({"previous": updater.current, "pending": updater.desired})
        with patch.object(updater, "validate_packaging_docker", side_effect=module.UpdateError("Packaging caps unavailable")):
            with self.assertRaisesRegex(module.UpdateError, "Packaging caps unavailable"):
                updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.current])
        self.assertNotIn("pending", json.loads(updater.state_path.read_text()))
        self.assertEqual(updater.pulls, [])
        self.assertEqual(updater.packages, 0)

    def test_interrupted_audio_transaction_requires_original_enabled_scope(self):
        updater = self.updater(audio=True)
        updater.save({"previous": updater.current, "pending": updater.desired})
        disabled = self.updater()
        with self.assertRaisesRegex(module.UpdateError, "different mode"):
            disabled.run()
        self.assertEqual(disabled.activations, [])
        self.assertEqual(disabled.pulls, [])

    def test_untrusted_recovery_service_or_image_is_refused_before_activation(self):
        updater = self.updater(audio=True)
        for bad in ({"proxy": "sha256:" + "a" * 64}, {module.WEB: "untrusted:tag"}):
            updater.save({"previous": bad, "pending": updater.desired})
            with self.assertRaisesRegex(module.UpdateError, "invalid service or image"):
                updater.run()
            self.assertEqual(updater.activations, [])

    def test_wrong_mount_profile_or_secret_contract_is_refused(self):
        mutations = [
            lambda s: s.update(profiles=[]),
            lambda s: s["volumes"][0].update(source="/arbitrary/assets/music"),
            lambda s: s["volumes"][0].update(read_only=False),
            lambda s: s["volumes"][0]["bind"].update(create_host_path=True),
            lambda s: s["volumes"].append({"source": "/var/run/docker.sock"}),
            lambda s: s["environment"].update(AUDIO_MEDIA_ROOT="/private/other"),
            lambda s: s["secrets"][0].update(source="another_key"),
        ]
        for change in mutations:
            updater = self.updater(audio=True)
            change(updater.config["services"][module.AUDIO])
            with self.assertRaises(module.UpdateError):
                updater.run()
            self.assertEqual(updater.pulls, [])
            self.assertEqual(updater.packages, 0)

    def test_old_compose_omitted_false_bind_flag_is_accepted_only_for_existing_exact_library(self):
        updater = self.updater(audio=True)
        updater.config["services"][module.AUDIO]["volumes"][0]["bind"] = {}
        updater.validate_audio(updater.config)
        (self.directory / "gyaruinthemix/assets/music").rmdir()
        with self.assertRaisesRegex(module.UpdateError, "existing non-symlinked"):
            updater.validate_audio(updater.config)

    def test_key_is_metadata_checked_outside_checkout_and_never_read(self):
        updater = self.updater(audio=True)
        with patch.object(Path, "read_bytes", side_effect=AssertionError("key read")):
            updater.validate_audio(updater.config)
        for filename in ("relative/key", str(self.directory / "gyaruinthemix/secrets/key"),
                         str(self.directory / "gyaruinthemix/../key")):
            updater.config["secrets"][module.AUDIO_SECRET]["file"] = filename
            with self.assertRaisesRegex(module.UpdateError, "outside the checkout"):
                updater.validate_audio(updater.config)
        key = self.directory / "linked-key"
        key.symlink_to(self.directory / "signing-key-fixture")
        updater.config["secrets"][module.AUDIO_SECRET]["file"] = str(key)
        with self.assertRaisesRegex(module.UpdateError, "outside the checkout"):
            updater.validate_audio(updater.config)


class AudioBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def updater(self, **kwargs):
        class FakePackager(FakeUpdater, module.AudioPackager):
            run = module.AudioPackager.run
        return FakePackager(self.directory, **kwargs)

    def test_bootstrap_prepares_matching_release_without_existing_sidecar_or_activation(self):
        updater = self.updater(audio=True)
        updater.current = {}
        updater.run()
        self.assertEqual(updater.packages, 1)
        self.assertEqual(updater.pulls, [module.REGISTRY + "web:main", module.REGISTRY + "game-audio:main",
                                        module.PACKAGER + ":sha-" + "a" * 40])
        self.assertEqual(updater.packaged_images, [updater.packager_image])
        self.assertEqual(updater.activations, [])
        self.assertFalse(updater.state_path.exists())

    def test_bootstrap_requires_installed_opt_in(self):
        updater = self.updater()
        with self.assertRaisesRegex(module.UpdateError, "enable GAME_AUDIO_ENABLED"):
            updater.run()
        self.assertEqual(updater.packages, 0)
        self.assertEqual(updater.pulls, [])

    def test_bootstrap_derives_same_pinned_release_including_existing_api_mode(self):
        updater = self.updater(mode="api", audio=True)
        for service in updater.services:
            updater.config["services"][service]["image"] = updater.config["services"][service]["image"].removesuffix(":main") + ":sha-" + "a" * 40
        updater.run()
        self.assertEqual(updater.packaged_images, [updater.packager_image])
        self.assertEqual(len(updater.pulls), 4)
        self.assertTrue(all(reference.endswith(":sha-" + "a" * 40) for reference in updater.pulls))
        self.assertIn("checkout-api", updater.compose_args)
        self.assertEqual(updater.activations, [])

    def test_bootstrap_refuses_mixed_or_unreviewed_service_releases(self):
        for failure in ("mixed", "untrusted", "wrong-mode", "wrong-tag"):
            with self.subTest(failure=failure):
                updater = self.updater(audio=True)
                if failure == "mixed":
                    updater.revisions[module.AUDIO] = "b" * 40
                elif failure == "untrusted":
                    updater.config["services"][module.AUDIO]["image"] = "other/audio:main"
                elif failure == "wrong-mode":
                    updater.image_mode = "api"
                else:
                    updater.config["services"][module.AUDIO]["image"] = module.REGISTRY + "game-audio:sha-" + "b" * 40
                with self.assertRaises(module.UpdateError):
                    updater.run()
                self.assertEqual(updater.packages, 0)
                self.assertEqual(updater.activations, [])
                self.assertFalse(any(reference.startswith(module.PACKAGER + ":") for reference in updater.pulls))

    def test_bootstrap_uses_shared_lock_and_refuses_unrecovered_transactions(self):
        argv = ["update.py", "--directory", str(self.directory), "--package-game-audio"]
        with patch.object(module.sys, "argv", argv), patch.object(module.AudioPackager, "run") as run:
            self.assertEqual(module.main(), 0)
            run.assert_called_once()
        updater = self.updater(audio=True)
        updater.save({"previous": updater.current, "pending": updater.desired})
        with patch.object(module.sys, "argv", argv), patch.object(module.AudioPackager, "run") as run:
            self.assertEqual(module.main(), 1)
            run.assert_not_called()

    def test_bootstrap_flags_are_mutually_exclusive(self):
        argv = ["update.py", "--shared", "--package-game-audio"]
        with patch.object(module.sys, "argv", argv), self.assertRaises(SystemExit):
            module.main()


class MockPackagerDaemon:
    """Mock only the daemon protocol; real temporary directory checks still run."""
    identifier = "c" * 64

    def __init__(self):
        self.calls = []
        self.containers = {}
        self.wait_result = "0\n"
        self.wait_error = None
        self.create_error = None
        self.create_commits = True
        self.stop_error = None
        self.remove_error = None
        self.foreign = False

    def __call__(self, *args, timeout=30):
        self.calls.append((args, timeout))
        if args[0] == "create":
            name = args[args.index("--name") + 1]
            label = args[args.index("--label") + 1].split("=", 1)
            if self.create_commits:
                self.containers[self.identifier] = {
                    "Id": self.identifier, "Name": "/" + name, "Image": args[-1],
                    "Config": {"Labels": {label[0]: "foreign" if self.foreign else label[1]}},
                    "State": {"Running": False},
                }
            if self.create_error:
                raise self.create_error
            return self.identifier + "\n"
        if args[0] == "ps":
            selector = args[-1]
            return "\n".join(identifier for identifier, record in self.containers.items()
                             if selector == "id=" + identifier or
                             selector == "name=^" + record["Name"] + "$")
        if args[0] == "inspect":
            return json.dumps([self.containers[args[-1]]])
        if args[0] == "start":
            self.containers[args[-1]]["State"]["Running"] = True
            return args[-1]
        if args[0] == "wait":
            if self.wait_error:
                raise self.wait_error
            self.containers[args[-1]]["State"]["Running"] = False
            return self.wait_result
        if args[0] == "stop":
            if self.stop_error:
                raise self.stop_error
            self.containers[args[-1]]["State"]["Running"] = False
            return args[-1]
        if args[0] == "rm":
            if self.remove_error:
                raise self.remove_error
            del self.containers[args[-1]]
            return args[-1]
        raise AssertionError(args)


class AudioPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.checkout = self.directory / "gyaruinthemix"
        self.library = self.checkout / "assets/music"
        self.output = self.library / ".hls"
        self.output.mkdir(parents=True)
        self.library.chmod(0o750)
        self.output.chmod(0o2750)
        self.updater = module.Updater(self.directory)
        self.image = "sha256:" + "d" * 64
        self.daemon = MockPackagerDaemon()
        self.updater.packaging_docker = self.daemon
        self.metadata = {}
        original_stat = Path.stat

        def fixture_stat(path, *args, **kwargs):
            info = original_stat(path, *args, **kwargs)
            if path == self.library or self.library in path.parents:
                fields = list(info)
                fields[4], fields[5] = 1000, module.AUDIO_GROUP
                for field, value in self.metadata.get(path, {}).items():
                    fields[field] = value
                return os.stat_result(fields)
            return info

        for context in (patch.object(module.os, "geteuid", return_value=1000),
                        patch.object(Path, "stat", fixture_stat),
                        patch.object(self.updater, "validate_packaging_docker")):
            context.start()
            self.addCleanup(context.stop)

    def commands(self, operation):
        return [args for args, _ in self.daemon.calls if args[0] == operation]

    def test_only_baked_code_immutable_image_private_mounts_and_fixed_bounds(self):
        source = self.library / "original.wav"
        source.write_bytes(b"synthetic-original-bytes")
        source.chmod(0o600)
        before = source.read_bytes()
        with patch.dict(os.environ, {"NODE_OPTIONS": "untrusted", "FFREPORT": "untrusted"}), \
             patch.object(module.subprocess, "Popen", side_effect=AssertionError("host executable invoked")):
            self.updater.package_audio(self.image)
        command, = self.commands("create")
        self.assertEqual(command[-1], self.image)
        expected = {"--user": "1000:10001", "--memory": "192m", "--memory-swap": "192m",
                    "--cpus": "0.50", "--pids-limit": "64", "--network": "none", "--cap-drop": "ALL",
                    "--security-opt": "no-new-privileges:true", "--restart": "no", "--pull": "never",
                    "--log-driver": "none", "--tmpfs": "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777"}
        for flag, value in expected.items():
            self.assertEqual(command[command.index(flag) + 1], value)
        self.assertIn("--read-only", command)
        self.assertEqual([command[i + 1] for i, arg in enumerate(command) if arg == "--ulimit"],
                         ["core=0:0", "nofile=256:256"])
        self.assertEqual([command[i + 1] for i, arg in enumerate(command) if arg == "--mount"], [
            f"type=bind,src={self.library},dst=/library/assets/music,readonly",
            f"type=bind,src={self.output},dst=/library/assets/music/.hls"])
        self.assertTrue({"--privileged", "--device", "--env", "--env-file", "--entrypoint", "--volume", "--volumes-from"}.isdisjoint(command))
        self.assertFalse(any("signing" in value or "docker.sock" in value for value in command))
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(self.daemon.containers, {})
        self.assertEqual(self.commands("stop"), [("stop", "--time", "5", self.daemon.identifier)])
        self.assertEqual(self.commands("rm"), [("rm", "--force", self.daemon.identifier)])
        self.assertEqual(next(timeout for args, timeout in self.daemon.calls if args[0] == "wait"), module.AUDIO_TIMEOUT)

    def test_no_host_node_ffmpeg_or_checkout_script_is_required(self):
        self.assertFalse((self.checkout / "game-audio/scripts/package-library.mjs").exists())
        self.updater.package_audio(self.image)
        self.assertEqual(len(self.commands("create")), 1)

    def test_root_refusal_and_mutable_image_refusal_happen_before_container_creation(self):
        with patch.object(module.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(module.UpdateError, "non-root deployment owner"):
                self.updater.package_audio(self.image)
        for image in ("untrusted:latest", module.PACKAGER + ":main", "sha256:short", None):
            with self.assertRaisesRegex(module.UpdateError, "immutable"):
                self.updater.package_audio(image)
        self.assertEqual(self.daemon.calls, [])

    def test_symlinked_or_missing_checkout_library_output_is_refused(self):
        for path in (self.checkout, self.library, self.output):
            original = path.with_name(path.name + "-original")
            path.rename(original)
            path.symlink_to(original)
            with self.assertRaisesRegex(module.UpdateError, "non-symlinked"):
                self.updater.package_audio(self.image)
            path.unlink()
            original.rename(path)
        self.output.rmdir()
        with self.assertRaisesRegex(module.UpdateError, "existing"):
            self.updater.package_audio(self.image)
        self.assertEqual(self.daemon.calls, [])

    def test_wrong_ownership_group_or_wide_output_modes_fail_without_chmod(self):
        for path, metadata in ((self.library, {4: 2000}), (self.library, {5: 2000}),
                               (self.library, {0: 0o40700}), (self.output, {5: 2000}),
                               (self.output, {0: 0o42770}), (self.output, {0: 0o40750}),
                               (self.output, {0: 0o42755})):
            with self.subTest(path=path, metadata=metadata):
                self.metadata[path] = metadata
                with patch.object(Path, "chmod", side_effect=AssertionError("permissions changed")), \
                     patch.object(module.os, "chown", side_effect=AssertionError("ownership changed")):
                    with self.assertRaisesRegex(module.UpdateError, "private library"):
                        self.updater.package_audio(self.image)
                self.metadata.clear()
        self.assertEqual(self.daemon.calls, [])

    def test_existing_lock_and_unsafe_cache_links_fail_closed(self):
        lock = self.output / ".packaging.lock"
        lock.write_text("fixture")
        with self.assertRaisesRegex(module.UpdateError, "existing audio packaging lock"):
            self.updater.package_audio(self.image)
        self.assertEqual(lock.read_text(), "fixture")
        lock.unlink()
        source = self.library / "original.wav"
        source.write_bytes(b"source")
        for kind in ("symlink", "hardlink"):
            target = self.output / "unsafe.json"
            target.symlink_to(source) if kind == "symlink" else os.link(source, target)
            with self.assertRaisesRegex(module.UpdateError, "unsafe links"):
                self.updater.package_audio(self.image)
            target.unlink()
        self.assertEqual(source.read_bytes(), b"source")
        self.assertEqual(self.daemon.calls, [])

    def test_failure_timeout_and_interrupt_stop_remove_exact_helper_restore_handlers(self):
        original = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
        for outcome in ("1\n", subprocess.TimeoutExpired("docker wait", 600), KeyboardInterrupt()):
            with self.subTest(outcome=type(outcome).__name__):
                self.daemon.calls.clear()
                self.daemon.wait_result = outcome if isinstance(outcome, str) else "0"
                self.daemon.wait_error = None if isinstance(outcome, str) else outcome
                with self.assertRaises(KeyboardInterrupt if isinstance(outcome, KeyboardInterrupt) else module.UpdateError):
                    self.updater.package_audio(self.image)
                self.assertEqual(self.daemon.containers, {})
                self.assertEqual(self.commands("stop"), [("stop", "--time", "5", self.daemon.identifier)])
                self.assertEqual(self.commands("rm"), [("rm", "--force", self.daemon.identifier)])
                self.assertEqual(original, {number: signal.getsignal(number) for number in original})

    def test_actual_signal_handler_interrupt_still_cleans_daemon_container(self):
        original = self.updater.packaging_docker

        def interrupted(*args, **kwargs):
            if args[0] == "wait":
                signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            return original(*args, **kwargs)

        self.updater.packaging_docker = interrupted
        with self.assertRaisesRegex(module.UpdateError, "interrupted"):
            self.updater.package_audio(self.image)
        self.assertEqual(self.daemon.containers, {})

    def test_timed_out_create_recovers_owned_name_without_starting_or_touching_other_containers(self):
        self.daemon.create_error = subprocess.TimeoutExpired("docker create", 30)
        unrelated = {"Id": "f" * 64, "Name": "/proxy", "Image": self.image, "Config": {"Labels": {}}, "State": {"Running": True}}
        self.daemon.containers[unrelated["Id"]] = unrelated
        with self.assertRaisesRegex(module.UpdateError, "bounded deadline"):
            self.updater.package_audio(self.image)
        self.assertEqual(self.commands("start"), [])
        self.assertEqual(self.daemon.containers, {unrelated["Id"]: unrelated})
        self.assertEqual(self.commands("rm"), [("rm", "--force", self.daemon.identifier)])

    def test_uncertain_create_absent_result_is_not_claimed_as_successful_cleanup(self):
        self.daemon.create_commits = False
        self.daemon.create_error = subprocess.TimeoutExpired("docker create", 30)
        with self.assertRaisesRegex(module.UpdateError, "creation outcome is uncertain"):
            self.updater.package_audio(self.image)
        self.assertEqual(self.commands("start"), [])
        self.assertEqual(self.commands("rm"), [])

    def test_foreign_container_is_never_started_stopped_or_removed(self):
        self.daemon.foreign = True
        with self.assertRaisesRegex(module.UpdateError, "ownership could not be verified"):
            self.updater.package_audio(self.image)
        for command in ("start", "stop", "rm"):
            self.assertEqual(self.commands(command), [])
        self.assertIn(self.daemon.identifier, self.daemon.containers)

    def test_stop_error_still_force_removes_exact_container(self):
        self.daemon.stop_error = subprocess.TimeoutExpired("docker stop", 15)
        self.updater.package_audio(self.image)
        self.assertEqual(self.daemon.containers, {})

    def test_unconfirmed_removal_is_an_error_not_a_success_message(self):
        self.daemon.remove_error = subprocess.TimeoutExpired("docker rm", 30)
        with self.assertRaisesRegex(module.UpdateError, "cleanup is unconfirmed"):
            self.updater.package_audio(self.image)
        self.assertIn(self.daemon.identifier, self.daemon.containers)


class PackagerReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.updater = FakeUpdater(self.temporary.name, audio=True)

    def test_exact_sha_repository_role_and_immutable_id(self):
        identifier = self.updater.prepare_packager("a" * 40)
        self.assertEqual(identifier, self.updater.packager_image)
        self.assertEqual(self.updater.pulls, [module.PACKAGER + ":sha-" + "a" * 40])

    def test_untrusted_mismatched_or_invalid_packager_never_packages_or_activates(self):
        for attribute, value in (("packager_revision", "b" * 40), ("source", "https://untrusted.invalid"),
                                 ("packager_role", "audio-server"), ("packager_role", None),
                                 ("packager_image", "mutable:main")):
            with self.subTest(attribute=attribute):
                updater = FakeUpdater(self.temporary.name, audio=True)
                setattr(updater, attribute, value)
                with self.assertRaises(module.UpdateError):
                    updater.run()
                self.assertEqual(updater.packages, 0)
                self.assertEqual(updater.activations, [])
                self.assertFalse(updater.state_path.exists())

    def test_missing_matching_packager_never_activates_services(self):
        original = self.updater.docker

        def absent(*args):
            if args == ("pull", module.PACKAGER + ":sha-" + "a" * 40):
                raise module.UpdateError("Matching packager publication is unavailable")
            return original(*args)

        self.updater.docker = absent
        with self.assertRaisesRegex(module.UpdateError, "publication is unavailable"):
            self.updater.run()
        self.assertEqual(self.updater.packages, 0)
        self.assertEqual(self.updater.activations, [])
        self.assertFalse(self.updater.state_path.exists())

    def test_invalid_revision_never_pulls(self):
        for revision in ("main", "a" * 39, "A" * 40, None):
            with self.assertRaisesRegex(module.UpdateError, "full release"):
                self.updater.prepare_packager(revision)
        self.assertEqual(self.updater.pulls, [])


class PackagerDockerPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.updater = module.Updater(self.temporary.name)
        self.info = {"Architecture": "amd64", "SecurityOptions": ["name=seccomp,profile=builtin"],
                     "MemoryLimit": True, "SwapLimit": True, "CpuCfsQuota": True,
                     "CpuCfsPeriod": True, "PidsLimit": True}
        self.host = "unix:///var/run/docker.sock"
        self.calls = []

        def docker(*args):
            self.calls.append(args)
            if args == ("context", "inspect"):
                return json.dumps([{"Endpoints": {"docker": {"Host": self.host}}}])
            if args == ("info", "--format", "{{json .}}"):
                return json.dumps(self.info)
            raise AssertionError(args)

        self.updater.docker = docker

    def test_supported_local_rootful_daemon_passes(self):
        self.updater.validate_packaging_docker()
        self.assertEqual(len(self.calls), 2)

    def test_missing_or_false_caps_fail_closed(self):
        for capability in ("MemoryLimit", "SwapLimit", "CpuCfsQuota", "CpuCfsPeriod", "PidsLimit"):
            for value in (False, None, "true", 1):
                self.info[capability] = value
                with self.assertRaisesRegex(module.UpdateError, "every required"):
                    self.updater.validate_packaging_docker()
            self.info[capability] = True

    def test_remote_rootless_userns_or_wrong_architecture_are_rejected(self):
        self.host = "ssh://other"
        with self.assertRaisesRegex(module.UpdateError, "local Docker"):
            self.updater.validate_packaging_docker()
        self.host = "unix:///var/run/docker.sock"
        for option in ("name=rootless", "name=userns"):
            self.info["SecurityOptions"] = [option]
            with self.assertRaisesRegex(module.UpdateError, "rootful Docker"):
                self.updater.validate_packaging_docker()
        self.info["SecurityOptions"] = []
        self.info["Architecture"] = "aarch64"
        with self.assertRaisesRegex(module.UpdateError, "amd64"):
            self.updater.validate_packaging_docker()


if __name__ == "__main__":
    unittest.main()
