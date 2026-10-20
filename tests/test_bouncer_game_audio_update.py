"""Offline audio lifecycle, confinement and Linux resource tests; no host deployment."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

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

    def test_bootstrap_packages_without_existing_sidecar_or_image_operations(self):
        updater = self.updater(audio=True)
        updater.current = {}
        updater.run()
        self.assertEqual(updater.packages, 1)
        self.assertEqual(updater.pulls, [])
        self.assertEqual(updater.activations, [])
        self.assertFalse(updater.state_path.exists())

    def test_bootstrap_requires_installed_opt_in(self):
        updater = self.updater()
        with self.assertRaisesRegex(module.UpdateError, "enable GAME_AUDIO_ENABLED"):
            updater.run()
        self.assertEqual(updater.packages, 0)
        self.assertEqual(updater.pulls, [])

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


class AudioPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.checkout = self.directory / "gyaruinthemix"
        self.library = self.checkout / "assets/music"
        self.script = self.checkout / "game-audio/scripts/package-library.mjs"
        self.library.mkdir(parents=True)
        self.script.parent.mkdir(parents=True)
        self.script.write_text("// Synthetic fixture, never executed by mocked tests.\n")
        self.updater = module.Updater(self.directory)

    def test_only_fixed_script_paths_and_sanitized_commands_are_used(self):
        with patch.object(module.shutil, "which", side_effect=lambda n, **_: "/usr/bin/" + n), \
             patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "v24.19.0\n")), \
             patch.object(self.updater, "audio_process") as process:
            self.updater.package_audio()
        process.assert_called_once_with(["/usr/bin/node", "--jitless", "--max-old-space-size=64", str(self.script), str(self.library), "--strict"])

    def test_missing_prerequisite_or_node_version_never_runs_packager(self):
        for version in ("v22.1.0\n", "v25.0.0\n", "v24.untrusted\n"):
            with patch.object(module.shutil, "which", side_effect=lambda n, **_: "/usr/bin/" + n), \
                 patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, version)), \
                 patch.object(self.updater, "audio_process") as process:
                with self.assertRaisesRegex(module.UpdateError, "requires Node 24"):
                    self.updater.package_audio()
                process.assert_not_called()
        with patch.object(module.shutil, "which", return_value=None), \
             patch.object(self.updater, "audio_process") as process:
            with self.assertRaisesRegex(module.UpdateError, "operator-installed"):
                self.updater.package_audio()
            process.assert_not_called()

    def test_symlinked_library_or_script_is_refused(self):
        for path in (self.library, self.script):
            original = path.with_name(path.name + "-original")
            path.rename(original)
            path.symlink_to(original)
            with self.assertRaisesRegex(module.UpdateError, "symlinked"):
                self.updater.package_audio()
            path.unlink()
            original.rename(path)

    def test_process_has_limits_sanitized_environment_and_low_priority(self):
        probe = self.checkout / "probe.json"
        code = ("import json,os,resource; from pathlib import Path; "
                "Path('probe.json').write_text(json.dumps({'env':dict(os.environ),"
                "'as':resource.getrlimit(resource.RLIMIT_AS),'data':resource.getrlimit(resource.RLIMIT_DATA),"
                "'cpu':resource.getrlimit(resource.RLIMIT_CPU),'affinity':list(os.sched_getaffinity(0)),"
                "'nice':os.getpriority(os.PRIO_PROCESS,0),'umask':os.umask(0)}))")
        with patch.dict(os.environ, {"NODE_OPTIONS": "untrusted", "FFREPORT": "untrusted", "AUDIO_SIGNING_KEY_FILE": "secret"}):
            self.updater.audio_process([sys.executable, "-c", code])
        observed = json.loads(probe.read_text())
        self.assertEqual(observed["as"], [768 * 1024 ** 2] * 2)
        self.assertEqual(observed["data"], [128 * 1024 ** 2] * 2)
        self.assertEqual(observed["cpu"], [300] * 2)
        self.assertEqual(len(observed["affinity"]), 1)
        self.assertGreaterEqual(observed["nice"], 10)
        self.assertEqual(observed["umask"], 0o027)
        self.assertTrue({"NODE_OPTIONS", "FFREPORT", "AUDIO_SIGNING_KEY_FILE"}.isdisjoint(observed["env"]))
        self.assertEqual(observed["env"]["PATH"], module.AUDIO_PATH)

    def test_timeout_kills_the_entire_subprocess_group_and_restores_signal_handlers(self):
        handlers = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
        with patch.object(module.os, "killpg", wraps=os.killpg) as kill:
            with self.assertRaisesRegex(module.UpdateError, "600-second limit"):
                self.updater.audio_process([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.05)
            kill.assert_called_once()
            self.assertEqual(kill.call_args.args[1], signal.SIGKILL)
        self.assertEqual(handlers, {s: signal.getsignal(s) for s in handlers})

    @unittest.skipUnless(shutil.which("node") and shutil.which("ffmpeg") and shutil.which("ffprobe"), "synthetic packaging requires existing node/ffmpeg/ffprobe")
    def test_real_synthetic_packaging_reuses_cache_without_touching_source(self):
        node = shutil.which("node")
        version = subprocess.run([node, "--version"], capture_output=True, text=True, check=True).stdout
        if not version.startswith("v24."):
            self.skipTest("bounded synthetic packaging requires Node 24")
        shutil.copyfile(ROOT / "game-audio/scripts/package-library.mjs", self.script)
        source = self.library / "synthetic.wav"
        with wave.open(str(source), "wb") as output:
            output.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
            output.writeframes(b"\0\0" * 48000)
        original = hashlib.sha256(source.read_bytes()).hexdigest()
        modified = source.stat().st_mtime_ns
        command = [node, "--jitless", "--max-old-space-size=64", str(self.script), str(self.library), "--strict"]
        self.updater.audio_process(command)
        catalog = json.loads((self.library / ".hls/catalog.json").read_text())
        track = self.library / ".hls" / catalog["tracks"][0]["id"] / "track.json"
        cached = track.stat().st_mtime_ns
        self.updater.audio_process(command)
        self.assertEqual(track.stat().st_mtime_ns, cached)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)
        self.assertEqual(source.stat().st_mtime_ns, modified)
        self.assertFalse((self.library / ".hls/.packaging.lock").exists())
        previous_catalog = (self.library / ".hls/catalog.json").read_bytes()
        previous_time = (self.library / ".hls/catalog.json").stat().st_mtime_ns
        (self.library / "corrupt.mp3").write_bytes(b"synthetic-invalid-audio")
        with self.assertRaisesRegex(module.UpdateError, "packaging failed"):
            self.updater.audio_process(command)
        self.assertEqual((self.library / ".hls/catalog.json").read_bytes(), previous_catalog)
        self.assertEqual((self.library / ".hls/catalog.json").stat().st_mtime_ns, previous_time)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)


if __name__ == "__main__":
    unittest.main()
