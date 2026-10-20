"""Offline guided-setup tests: mocked Docker/tools and disposable synthetic fixtures only."""
import contextlib
import copy
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("audio_setup", ROOT / "deploy/bouncer/setup-audio.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
CANONICAL = (ROOT / "deploy/bouncer/docker-compose.yml").read_text()


def legacy_compose():
    text = CANONICAL
    for section, name in (("services", setup.AUDIO), ("secrets", setup.update.AUDIO_SECRET)):
        start, end = setup.entry(text, section, name)
        text = text[:start] + text[end:]
    return "\n".join(line for line in text.splitlines() if "GAME_AUDIO_ENABLED:" not in line and "Resolved by the installed updater" not in line) + "\n"


class FakeSetup(setup.AudioSetup):
    def __init__(self, directory, key_file=None, mode="payment_links", legacy=True):
        super().__init__(directory, key_file)
        self.mode = mode
        self.calls = []
        self.activations = []
        self.packaged = 0
        self.fail_package = False
        self.fail_activate = False
        self.fail_rollback = False
        self.concurrent = False
        self.revision = "a" * 40
        self.image_revision = self.revision
        self.image_source = setup.update.SOURCE
        self.image_mode = mode
        self.architecture = "amd64"
        self.security_options = []
        self.remote = False
        self.containers = {}
        self.ids = {setup.WEB: "1" * 64, setup.API: "2" * 64, setup.AUDIO: "3" * 64, "proxy": "4" * 64}
        self.desired = {setup.WEB: "sha256:" + "a" * 64, setup.AUDIO: "sha256:" + "b" * 64}
        if mode == "api":
            self.desired[setup.API] = "sha256:" + "c" * 64
        self.checkout.mkdir()
        (self.checkout / "deploy/bouncer").mkdir(parents=True)
        (self.checkout / "deploy/bouncer/docker-compose.yml").write_text(CANONICAL)
        self.hls.mkdir(parents=True)
        (self.directory / "docker-compose.yml").write_text(legacy_compose() if legacy else CANONICAL)
        (self.directory / ".env").write_text("# operator note\nCOMPOSE_PROJECT_NAME=existing-bouncer\nSTORE_DOMAIN=example.invalid\nCHECKOUT_MODE=" + mode + "\nCOMPOSE_PROFILES=" + ("checkout-api,operator-extra" if mode == "api" else "operator-extra") + "\nUNRELATED='keep # this' # unchanged\n")
        self.fixture_key = Path.home() / ".gyaruinthemix-secrets/game_audio_signing_key"
        self.fixture_key.parent.mkdir(mode=0o700, exist_ok=True)
        self.fixture_key.write_bytes(b"synthetic fixture, not a real key" * 2)
        self.fixture_key.chmod(0o600)
        self.add_container(setup.WEB, "sha256:" + "1" * 64)
        self.add_container("proxy", "sha256:" + "4" * 64)
        if mode == "api":
            self.add_container(setup.API, "sha256:" + "2" * 64)

    def add_container(self, name, image, labels=None):
        self.containers[name] = {"Id": self.ids[name], "Image": image,
                                 "Config": {"Labels": {"com.docker.compose.project": "existing-bouncer", "com.docker.compose.service": name, **(labels or {})}},
                                 "RestartCount": 0, "State": {"Running": True, "Restarting": False, "StartedAt": "2026-10-20T00:00:00Z", "Health": {"Status": "healthy"}}}

    def dependencies(self):
        pass

    def reviewed_checkout(self):
        return self.revision

    def permissions(self, key):
        return []

    def config_document(self, document, changes):
        text = (self.directory / ".env").read_bytes().decode()
        values = {key: setup.dotenv_value(text, key) for key in setup.MANAGED_ENV}
        values.update(changes)
        enabled = values["GAME_AUDIO_ENABLED"] or "false"
        config = {"name": "existing-bouncer", "services": {
            "proxy": {"build": {"context": str(self.directory / "proxy")}},
            setup.WEB: {"image": setup.update.REGISTRY + ("web-api" if self.mode == "api" else "web") + ":main", "build": {"args": {"CHECKOUT_MODE": self.mode}}, "environment": {}},
            setup.API: {"image": setup.update.REGISTRY + "api:main", "profiles": ["checkout-api"]},
        }, "secrets": {"other": {"file": str(self.directory / "other")}}}
        if "GAME_AUDIO_ENABLED:" in document:
            config["services"][setup.WEB]["environment"]["GAME_AUDIO_ENABLED"] = enabled
        if setup.AUDIO + ":" in document:
            config["services"][setup.AUDIO] = {"image": setup.update.REGISTRY + "game-audio:main", "profiles": ["game-audio"],
                "environment": {"GAME_AUDIO_ENABLED": enabled, "AUDIO_MEDIA_ROOT": "/private/media/.hls", "AUDIO_SIGNING_KEY_FILE": "/run/secrets/game_audio_signing_key"},
                "volumes": [{"type": "bind", "source": str(self.library), "target": "/private/media", "read_only": True, "bind": {"create_host_path": False}}],
                "secrets": [{"source": setup.update.AUDIO_SECRET, "target": "game_audio_signing_key"}]}
            config["secrets"][setup.update.AUDIO_SECRET] = {"file": values["GAME_AUDIO_SIGNING_KEY_FILE"] or str(self.fixture_key)}
        return config

    def compose(self, *args, images=None, labels=None):
        self.calls.append(("compose", args, images, labels))
        if args[0] == "config":
            return json.dumps(self.config_document((self.directory / "docker-compose.yml").read_text(), {}))
        if args[0] == "up":
            self.activations.append((args, images.copy(), labels))
            for name, image in images.items():
                self.ids[name] = ("e" if image == self.desired.get(name) else "f") + self.ids[name][1:]
                self.add_container(name, image, labels)
            if self.fail_activate and images == self.desired:
                raise setup.Error("synthetic health failure")
            if self.fail_rollback and images != self.desired:
                raise setup.Error("synthetic rollback failure")
            return ""
        raise AssertionError(args)

    def docker(self, *args):
        self.calls.append(("docker", args))
        if args == ("context", "inspect"):
            return json.dumps([{"Endpoints": {"docker": {"Host": "ssh://remote" if self.remote else "unix:///var/run/docker.sock"}}}])
        if args[:2] == ("info", "--format"):
            return json.dumps(self.security_options) if "SecurityOptions" in args[2] else self.architecture
        if args[0] == "ps":
            name = args[-1].split("=", 2)[-1]
            return self.containers.get(name, {}).get("Id", "")
        if args[0] == "inspect":
            return json.dumps([next(value for value in self.containers.values() if value["Id"] == args[1])])
        if args[0] == "pull":
            return ""
        if args[:2] == ("image", "inspect"):
            name = setup.AUDIO if "game-audio:" in args[2] else setup.API if args[2].startswith(setup.update.REGISTRY + "api:") else setup.WEB
            return json.dumps([{"Id": self.desired[name], "Config": {"Labels": {"org.opencontainers.image.source": self.image_source, "org.opencontainers.image.revision": self.image_revision, "io.gyaruinthemix.checkout-mode": self.image_mode}}}])
        if args[0] == "stop":
            return ""
        if args[0] == "rm":
            name = next(name for name, value in self.containers.items() if value["Id"] == args[1])
            del self.containers[name]
            return ""
        raise AssertionError(args)

    def package_audio(self):
        self.packaged += 1
        if self.fail_package:
            raise setup.Error("synthetic packaging failure")
        (self.hls / "catalog.json").write_text('{"synthetic":"catalog"}\n')
        if self.concurrent:
            self.containers[setup.WEB]["Image"] = "sha256:" + "9" * 64


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name) / "home"
        self.home.mkdir(mode=0o700)
        self.directory = self.home / "bouncer"
        self.directory.mkdir(mode=0o700)
        self.home_patch = patch.object(Path, "home", return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        # The hosted test sandbox has ambient .git sentinel directories. Model real
        # Git ancestry only inside this disposable fixture, not the sandbox wrapper.
        self.git_patch = patch.object(setup, "inside_git", side_effect=lambda path: any((ancestor / ".git").exists() for ancestor in (Path(path), *Path(path).parents) if ancestor == self.home or self.home in ancestor.parents))
        self.git_patch.start()
        self.addCleanup(self.git_patch.stop)
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        self.addCleanup(self.redirect.__exit__, None, None, None)

    def fixture(self, **kwargs):
        return FakeSetup(self.directory, **kwargs)

    def tree(self):
        return {str(path.relative_to(self.home)): (path.stat().st_mode, path.read_bytes() if path.is_file() else None)
                for path in self.home.rglob("*")}

    def test_default_plan_has_no_writes_pulls_key_generation_or_container_actions(self):
        fixture = self.fixture()
        before = self.tree()
        with patch.object(setup.os, "urandom", side_effect=AssertionError("random called")), patch.object(setup, "AudioSetup", return_value=fixture):
            self.assertEqual(setup.main(["--directory", str(self.directory)]), 0)
        self.assertEqual(self.tree(), before)
        self.assertFalse((self.directory / setup.LOCK).exists())
        self.assertFalse(any(call[0] == "docker" and call[1][0] == "pull" for call in fixture.calls))

    def test_payment_links_activation_uses_same_release_and_scoped_ids(self):
        fixture = self.fixture()
        before_proxy = copy.deepcopy(fixture.containers["proxy"])
        key_before = fixture.fixture_key.read_bytes()
        plan = fixture.plan()
        fixture.apply(plan)
        self.assertEqual(len(fixture.activations), 1)
        args, images, labels = fixture.activations[0]
        self.assertEqual(set(images), {setup.WEB, setup.AUDIO})
        self.assertEqual(images, fixture.desired)
        self.assertIn("--no-deps", args)
        self.assertIn("--no-build", args)
        self.assertIn("--wait", args)
        self.assertEqual(args[args.index("--pull") + 1], "never")
        self.assertRegex(labels[setup.TRANSACTION_LABEL], r"^[0-9a-f]{32}$")
        self.assertEqual(fixture.containers["proxy"], before_proxy)
        self.assertEqual(fixture.fixture_key.read_bytes(), key_before)
        pulls = [call[1][1] for call in fixture.calls if call[0] == "docker" and call[1][0] == "pull"]
        self.assertTrue(all(image.endswith(":sha-" + "a" * 40) for image in pulls))
        self.assertEqual(fixture.read_journal()["phase"], "complete")
        self.assertIn("UNRELATED='keep # this' # unchanged", (self.directory / ".env").read_text())

    def test_api_mode_and_extra_profiles_preserved(self):
        fixture = self.fixture(mode="api")
        plan = fixture.plan()
        self.assertIn("COMPOSE_PROFILES=checkout-api,operator-extra,game-audio", plan["env_after"])
        fixture.apply(plan)
        self.assertEqual(set(fixture.activations[0][1]), {setup.WEB, setup.API, setup.AUDIO})

    def test_declined_and_noninteractive_apply_do_not_create_lock(self):
        fixture = self.fixture()
        for tty, answer in ((False, "ENABLE AUDIO " + "a" * 12), (True, "no")):
            with self.subTest(tty=tty), patch.object(setup, "AudioSetup", return_value=fixture), patch.object(setup.sys.stdin, "isatty", return_value=tty), patch.object(setup.sys.stdout, "isatty", return_value=tty), patch("builtins.input", return_value=answer):
                self.assertEqual(setup.main(["--directory", str(self.directory), "--apply"]), 1)
            self.assertFalse((self.directory / setup.LOCK).exists())
            self.assertFalse(fixture.activations)

    def test_missing_key_plan_does_not_generate_and_generation_is_exclusive_synthetic(self):
        fixture = self.fixture()
        fixture.fixture_key.unlink()
        plan = fixture.plan()
        self.assertFalse(plan["key_exists"])
        with patch.object(setup.os, "urandom", return_value=b"x" * 32) as random, patch.object(setup.os, "fchown"):
            fixture.provision(plan)
            self.assertEqual(fixture.fixture_key.read_bytes(), b"x" * 32)
            random.assert_called_once_with(32)
            with self.assertRaises(FileExistsError):
                fixture.provision(plan)
            random.assert_called_once_with(32)
        self.assertEqual(stat.S_IMODE(fixture.fixture_key.stat().st_mode), 0o640)

    def test_existing_key_is_never_read_or_rotated_by_provision(self):
        fixture = self.fixture()
        plan = fixture.plan()
        with patch.object(setup.os, "urandom", side_effect=AssertionError("rotation")), patch.object(Path, "read_bytes", side_effect=AssertionError("secret read")):
            fixture.provision(plan)

    def test_pull_label_failure_precedes_backups_or_config_mutation(self):
        fixture = self.fixture(mode="api")
        for attribute, value in (("image_revision", "b" * 40), ("image_source", "https://invalid.example"), ("image_mode", "payment_links")):
            with self.subTest(attribute=attribute):
                plan = fixture.plan()
                before = self.tree()
                old = getattr(fixture, attribute)
                setattr(fixture, attribute, value)
                with self.assertRaises(setup.Error):
                    fixture.apply(plan)
                setattr(fixture, attribute, old)
                self.assertEqual(self.tree(), before)
                self.assertEqual(fixture.packaged, 0)

    def test_packaging_failure_restores_configuration_without_activation(self):
        fixture = self.fixture()
        plan = fixture.plan()
        fixture.fail_package = True
        with self.assertRaisesRegex(setup.Error, "previous configuration/images were restored"):
            fixture.apply(plan)
        self.assertEqual((self.directory / ".env").read_text(), plan["env_before"])
        self.assertEqual((self.directory / "docker-compose.yml").read_text(), plan["compose_before"])
        self.assertEqual(fixture.activations, [])
        self.assertFalse(fixture.read_journal()["pending"])

    def test_health_failure_rolls_back_only_new_audio_and_prior_images(self):
        fixture = self.fixture()
        plan = fixture.plan()
        fixture.fail_activate = True
        with self.assertRaisesRegex(setup.Error, "were restored"):
            fixture.apply(plan)
        self.assertEqual([images for _, images, _ in fixture.activations], [fixture.desired, plan["previous"]])
        self.assertNotIn(setup.AUDIO, fixture.containers)
        self.assertEqual(fixture.containers[setup.WEB]["Image"], plan["previous"][setup.WEB])
        removals = [call for call in fixture.calls if call[0] == "docker" and call[1][0] == "rm"]
        self.assertEqual(len(removals), 1)
        self.assertEqual(removals[0][1][1], "e" + "3" * 63)

    def test_failed_rollback_is_recoverable_with_transaction_owned_prior_image(self):
        fixture = self.fixture()
        plan = fixture.plan()
        fixture.fail_activate = fixture.fail_rollback = True
        with self.assertRaisesRegex(setup.Error, "recovery remains pending"):
            fixture.apply(plan)
        state = fixture.read_journal()
        self.assertTrue(state["pending"])
        fixture.fail_rollback = False
        fixture.rollback(state)
        self.assertFalse(fixture.read_journal()["pending"])

    def test_orphan_and_stopped_audio_are_rejected_for_legacy_compose(self):
        fixture = self.fixture()
        fixture.add_container(setup.AUDIO, "sha256:" + "5" * 64)
        with self.assertRaisesRegex(setup.Error, "already exists"):
            fixture.plan()
        fixture.containers[setup.AUDIO]["State"]["Running"] = False
        with self.assertRaisesRegex(setup.Error, "healthy"):
            fixture.plan()
        self.assertEqual(fixture.activations, [])

    def test_concurrent_container_change_retains_pending_without_overwriting(self):
        fixture = self.fixture()
        plan = fixture.plan()
        fixture.concurrent = True
        with self.assertRaisesRegex(setup.Error, "recovery remains pending"):
            fixture.apply(plan)
        self.assertEqual(fixture.activations, [])
        self.assertTrue(fixture.read_journal()["pending"])
        self.assertEqual(fixture.containers[setup.WEB]["Image"], "sha256:" + "9" * 64)

    def test_recovery_rejects_config_catalog_and_website_state_drift_before_mutating(self):
        fixture = self.fixture()
        plan = fixture.plan()
        state = fixture.snapshot(plan, fixture.desired)
        for name in (".env", "catalog", "website-state"):
            path = {".env": self.directory / ".env", "catalog": fixture.hls / "catalog.json", "website-state": fixture.state_path}[name]
            original = path.read_bytes() if path.exists() else None
            path.write_bytes(b"unrelated operator change")
            before = self.tree()
            with self.subTest(name=name), self.assertRaises(setup.Error):
                fixture.rollback(state)
            self.assertEqual(self.tree(), before)
            if original is None:
                path.unlink()
            else:
                path.write_bytes(original)

    def test_recovery_rejects_unowned_same_image_replacement(self):
        fixture = self.fixture()
        plan = fixture.plan()
        state = fixture.snapshot(plan, fixture.desired)
        state["phase"] = "activating"
        fixture.ids[setup.WEB] = "9" * 64
        fixture.add_container(setup.WEB, fixture.desired[setup.WEB])
        with self.assertRaisesRegex(setup.Error, "outside this transaction"):
            fixture.rollback(state)
        self.assertEqual(fixture.activations, [])

    def test_safe_rerun_does_not_rotate_or_recreate(self):
        fixture = self.fixture()
        fixture.apply(fixture.plan())
        fixture.activations.clear()
        before_key = fixture.fixture_key.read_bytes()
        fixture.apply(fixture.plan())
        self.assertEqual(fixture.activations, [])
        self.assertEqual(fixture.fixture_key.read_bytes(), before_key)

    def test_pending_guard_blocks_all_other_updater_modes(self):
        fixture = self.fixture()
        fixture.snapshot(fixture.plan(), fixture.desired)
        for mode in ("website", "shared", "znc-cert", "game-audio-package"):
            with self.subTest(mode=mode), self.assertRaisesRegex(setup.Error, "setup-audio.py --recover"):
                setup.update.guard_pending(self.directory, mode)
        setup.update.guard_pending(self.directory, "game-audio-setup")

    def test_backup_is_private_outside_deployment_and_contains_no_key(self):
        fixture = self.fixture()
        state = fixture.snapshot(fixture.plan(), fixture.desired)
        backup = Path(state["backup"])
        self.assertEqual(backup.parent, self.home)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertEqual({file.name for file in backup.iterdir()}, {"docker-compose.yml", ".env"})
        self.assertTrue(all(stat.S_IMODE(file.stat().st_mode) == 0o600 for file in backup.iterdir()))
        self.assertNotIn(fixture.fixture_key.read_text(), fixture.journal_path.read_text())

    def test_symlink_directory_key_backup_and_parent_git_are_refused(self):
        fixture = self.fixture()
        alias = self.home / "alias"
        alias.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaisesRegex(setup.Error, "symlink"):
            setup.AudioSetup(alias)
        key_alias = self.fixture_key_alias = self.home / "alias-key"
        key_alias.symlink_to(fixture.fixture_key)
        fixture.key_argument = str(key_alias)
        with self.assertRaisesRegex(setup.Error, "symlink"):
            fixture.plan()
        fixture.key_argument = str(self.directory / "private/key")
        (self.directory / ".git").mkdir()
        with self.assertRaisesRegex(setup.Error, "Git working tree"):
            fixture.plan()

    def test_docker_remote_rootless_userns_and_architecture_fail_closed(self):
        fixture = self.fixture()
        for attribute, value in (("remote", True), ("architecture", "arm64"), ("security_options", ["name=rootless"]), ("security_options", ["name=userns"])):
            old = getattr(fixture, attribute)
            setattr(fixture, attribute, value)
            with self.subTest(attribute=attribute), self.assertRaises(setup.Error):
                fixture.local_docker()
            setattr(fixture, attribute, old)

    def test_permissions_never_recurse_originals_and_require_existing_group_access(self):
        fixture = self.fixture()
        original = fixture.library / "unmodified.wav"
        original.write_bytes(b"synthetic original")
        original.chmod(0o600)
        before = original.read_bytes(), original.stat().st_mode
        with self.assertRaisesRegex(setup.Error, "group 10001"):
            setup.AudioSetup.permissions(fixture, fixture.fixture_key)
        self.assertEqual((original.read_bytes(), original.stat().st_mode), before)
        with patch.object(setup, "GROUP", os.getegid()):
            fixture.fixture_key.chmod(0o640)
            changes = setup.AudioSetup.permissions(fixture, fixture.fixture_key)
        self.assertTrue(set(item["path"] for item in changes).issubset({str(fixture.fixture_key.parent), str(fixture.library), str(fixture.hls)}))
        self.assertEqual(next(item for item in changes if item["path"] == str(fixture.hls))["after"]["mode"], 0o2750)

    def test_recovery_confirmation_is_invalidated_by_a_changed_pending_journal(self):
        fixture = self.fixture()
        initial = fixture.snapshot(fixture.plan(), fixture.desired)
        changed = copy.deepcopy(initial)
        changed["pending"] = False
        changed["phase"] = "rolled-back"
        def user_confirms(_token):
            fixture.write_journal(changed)
        with patch.object(setup, "AudioSetup", return_value=fixture), patch.object(setup, "confirm", side_effect=user_confirms), patch.object(fixture, "rollback") as rollback:
            self.assertEqual(setup.main(["--directory", str(self.directory), "--recover", "--apply"]), 1)
            rollback.assert_not_called()

    def test_busy_common_lock_stops_before_transaction_mutation(self):
        fixture = self.fixture()
        with patch.object(setup, "AudioSetup", return_value=fixture), patch.object(setup, "confirm"), patch.object(setup.fcntl, "flock", side_effect=BlockingIOError), patch.object(fixture, "apply") as apply:
            self.assertEqual(setup.main(["--directory", str(self.directory), "--apply"]), 1)
            apply.assert_not_called()
        self.assertFalse(fixture.journal_path.exists())

    def test_journal_schema_and_backup_integrity_are_fail_closed(self):
        fixture = self.fixture()
        original = fixture.snapshot(fixture.plan(), fixture.desired)
        mutations = [lambda state: state.update(project=42), lambda state: state.update(version=True),
                     lambda state: state.update(files=list(state["files"])),
                     lambda state: state["files"][".env"].update(mode=True),
                     lambda state: state.update(phase="complete"),
                     lambda state: state.update(backup=str(self.directory / (".bouncer-audio-backup-" + "a" * 32)))]
        for mutate in mutations:
            state = copy.deepcopy(original)
            mutate(state)
            fixture.write_journal(state)
            with self.subTest(state=state), self.assertRaises(setup.Error):
                fixture.read_journal()
        fixture.write_journal(original)
        (Path(original["backup"]) / ".env").write_text("changed backup")
        with self.assertRaisesRegex(setup.Error, "backup changed"):
            fixture.read_journal()

    def test_config_symlink_after_plan_is_not_followed(self):
        fixture = self.fixture()
        plan = fixture.plan()
        original = self.directory / ".env"
        moved = self.directory / "moved-env"
        original.rename(moved)
        original.symlink_to(moved)
        with self.assertRaisesRegex(setup.Error, "symlink"):
            fixture.check_baselines(plan)
        self.assertEqual(fixture.activations, [])

    def test_setup_shell_environment_does_not_override_routing_or_tools(self):
        with patch.dict(os.environ, {"STORE_DOMAIN": "other.invalid", "STORE_HOSTS": "other.invalid", "PATH": "/untrusted", "NODE_OPTIONS": "--inspect", "DOCKER_HOST": "ssh://other"}):
            fixture = self.fixture()
        self.assertEqual(fixture.env["PATH"], setup.update.AUDIO_PATH)
        self.assertTrue({"STORE_DOMAIN", "STORE_HOSTS", "NODE_OPTIONS", "DOCKER_HOST"}.isdisjoint(fixture.env))

    def test_raw_checkout_verification_never_uses_status_diff_or_filters(self):
        fixture = self.fixture()
        for name in setup.REVIEWED:
            path = fixture.checkout / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"synthetic reviewed source\n")
            path.chmod(0o644)
        tracked = {}
        for name in setup.REVIEWED:
            data = (fixture.checkout / name).read_bytes()
            tracked[name] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        commands = []
        def git(*args):
            commands.append(args)
            if args == ("rev-parse", "--show-toplevel"):
                return str(fixture.checkout) + "\n"
            if args == ("rev-parse", "HEAD"):
                return "a" * 40 + "\n"
            if args == ("ls-tree", "-r", "-z", "--full-tree", "HEAD"):
                return "".join(f"100644 blob {blob}\t{name}\0" for name, blob in tracked.items())
            if args == ("ls-files", "--stage", "-z"):
                return "".join(f"100644 {blob} 0\t{name}\0" for name, blob in tracked.items())
            if args[0] in ("check-ignore", "ls-files"):
                return ""
            raise AssertionError(args)
        with patch.object(fixture, "git", side_effect=git), patch.object(setup, "__file__", str(fixture.checkout / "deploy/bouncer/setup-audio.py")):
            self.assertEqual(setup.AudioSetup.reviewed_checkout(fixture), "a" * 40)
            (fixture.checkout / setup.REVIEWED[0]).write_bytes(b"unreviewed edit")
            with self.assertRaisesRegex(setup.Error, "differ from HEAD"):
                setup.AudioSetup.reviewed_checkout(fixture)
        self.assertTrue({"status", "diff", "hash-object"}.isdisjoint({args[0] for args in commands}))

    def test_noncanonical_audio_image_override_is_not_silently_changed(self):
        fixture = self.fixture()
        with (self.directory / ".env").open("a") as output:
            output.write("GYARUINTHEMIX_GAME_AUDIO_IMAGE=other/image:custom\n")
        before = self.tree()
        with self.assertRaisesRegex(setup.Error, "refusing to overwrite"):
            fixture.plan()
        self.assertEqual(self.tree(), before)

    def test_unwritable_existing_generated_directory_is_preflight_failure(self):
        fixture = self.fixture()
        with patch.object(setup, "GROUP", os.getegid()), patch.object(setup.os, "access", return_value=False), self.assertRaisesRegex(setup.Error, "write/traverse"):
            setup.AudioSetup.permissions(fixture, fixture.fixture_key)

    def test_crlf_env_round_trip_and_comment_preservation(self):
        fixture = self.fixture()
        path = self.directory / ".env"
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        fixture.apply(fixture.plan())
        self.assertNotIn(b"\n", path.read_bytes().replace(b"\r\n", b""))


class PureHelperTests(unittest.TestCase):
    def test_merge_preserves_local_shared_edits_and_line_endings(self):
        original = legacy_compose().replace("container_name: znc", "container_name: operator-znc\n    # local edit")
        for newline in ("\n", "\r\n"):
            with self.subTest(newline=repr(newline)):
                result = setup.merge_compose(original.replace("\n", newline), CANONICAL)
                self.assertIn("container_name: operator-znc" + newline + "    # local edit", result)
                self.assertEqual(result.count("  " + setup.AUDIO + ":"), 1)
                self.assertEqual(setup.merge_compose(result, CANONICAL), result)

    def test_unknown_managed_drift_fails_without_silently_overwriting(self):
        changed = legacy_compose().replace("    user: '101:101'", "    user: '0:0'")
        with self.assertRaisesRegex(setup.Error, "drift"):
            setup.merge_compose(changed, CANONICAL)

    def test_dotenv_preserves_unrelated_bytes_comments_and_profiles(self):
        text = "# note\r\nexport GAME_AUDIO_ENABLED = 'false' # retain\r\nUNRELATED=keep\r\n"
        changed = setup.change_dotenv(text, {"GAME_AUDIO_ENABLED": "true", "COMPOSE_PROFILES": "checkout-api,game-audio"})
        self.assertEqual(changed, "# note\r\nexport GAME_AUDIO_ENABLED =true # retain\r\nUNRELATED=keep\r\nCOMPOSE_PROFILES=checkout-api,game-audio\r\n")
        self.assertEqual(setup.dotenv_value("GAME_AUDIO_ENABLED='false' # note\n", "GAME_AUDIO_ENABLED"), "false")

    def test_dotenv_duplicate_interpolation_and_multiline_are_refused(self):
        for text in ("GAME_AUDIO_ENABLED=false\nGAME_AUDIO_ENABLED=true\n", "GAME_AUDIO_ENABLED=${VALUE}\n", "UNRELATED='first\nGAME_AUDIO_ENABLED=false\nlast'\n"):
            with self.subTest(text=text), self.assertRaises(setup.Error):
                setup.change_dotenv(text, {"GAME_AUDIO_ENABLED": "true"})

    def test_updater_labels_overlay_is_scoped_to_selected_images(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = setup.update.Updater(directory)
            def inspect(*args):
                files = [args[index + 1] for index, value in enumerate(args) if value == "-f"]
                overlay = json.loads(Path(files[-1]).read_text())
                self.assertEqual(overlay, {"services": {setup.WEB: {"image": "sha256:" + "a" * 64, "labels": {setup.TRANSACTION_LABEL: "synthetic"}}}})
                return ""
            with patch.object(updater, "docker", side_effect=inspect):
                updater.activate({setup.WEB: "sha256:" + "a" * 64}, labels={setup.TRANSACTION_LABEL: "synthetic"})


if __name__ == "__main__":
    unittest.main()
