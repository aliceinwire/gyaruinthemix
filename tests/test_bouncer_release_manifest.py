"""Immutable component selection and recovery without a Docker daemon."""
import copy
import json
import tempfile
import unittest
from test_bouncer_update import FakeUpdater, module


class ManifestUpdater(FakeUpdater):
    def __init__(self, directory, **kwargs):
        super().__init__(directory, release_manifest=True, **kwargs)
        self.release = {"schema": 1, "revision": "f" * 40, "components": {
            name: {"revision": str(i + 1) * 40, "digest": "sha256:" + str(i + 1) * 64, "input": "a" * 64}
            for i, name in enumerate(sorted(module.COMPONENTS))}}
        self.bad_component = None
        self.bad_field = None

    def docker(self, *args):
        if args[:2] == ("image", "inspect") and args[2].startswith(module.REGISTRY + "release:"):
            return json.dumps([{"Config": {"Labels": {
                "org.opencontainers.image.source": module.SOURCE,
                "org.opencontainers.image.revision": self.release["revision"],
                module.RELEASE_LABEL: json.dumps(self.release),
            }}}])
        if args[:2] == ("image", "inspect") and "@" in args[2]:
            name = args[2].removeprefix(module.REGISTRY).split("@")[0]
            entry = self.release["components"][name]
            service = {"web": module.WEB, "web-api": module.WEB, "api": module.API, "game-audio": module.AUDIO}.get(name)
            image = {"Id": self.desired[service] if service else self.packager_image,
                     "RepoDigests": [module.REGISTRY + name + "@" + entry["digest"]],
                     "Config": {"Labels": {
                         "org.opencontainers.image.source": module.SOURCE,
                         "org.opencontainers.image.revision": entry["revision"],
                         "io.gyaruinthemix.checkout-mode": "api" if name == "web-api" else "payment_links",
                         module.PACKAGER_ROLE: "audio-packager",
                     }}}
            if name == self.bad_component:
                if self.bad_field == "digest":
                    image["RepoDigests"] = []
                else:
                    image["Config"]["Labels"][self.bad_field] = "invalid"
            return json.dumps([image])
        return super().docker(*args)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
    def manifest_updater(self, **kwargs):
        return ManifestUpdater(self.directory.name, **kwargs)

    def test_components_with_different_revisions_update_as_one_release(self):
        updater = self.manifest_updater(mode="api", audio=True)
        updater.desired[module.API] = updater.current[module.API]
        updater.desired[module.AUDIO] = updater.current[module.AUDIO]
        updater.run()
        self.assertEqual(updater.activations[0][1], updater.desired)
        self.assertEqual(updater.packaged_images, [updater.packager_image])
        self.assertEqual(json.loads(updater.state_path.read_text())["revision"], "f" * 40)
        self.assertTrue(all("@sha256:" in reference for reference in updater.pulls[1:]))

    def test_bad_manifest_cannot_activate_a_partial_release(self):
        for field in ("digest", "revision", "input"):
            updater = self.manifest_updater(mode="api")
            updater.release["components"]["api"][field] = "invalid"
            with self.assertRaises(module.UpdateError):
                updater.run()
            self.assertEqual(updater.activations, [])

    def test_manifest_rejects_extra_or_missing_components(self):
        original = self.manifest_updater().release
        for name in module.COMPONENTS:
            value = copy.deepcopy(original)
            del value["components"][name]
            with self.assertRaises(module.UpdateError):
                module.validate_release_manifest(value)
        original["components"]["untrusted"] = original["components"]["web"]
        with self.assertRaises(module.UpdateError):
            module.validate_release_manifest(original)

    def test_digest_source_revision_and_role_must_match(self):
        for component, field in [
            ("api", "digest"), ("web-api", "org.opencontainers.image.source"),
            ("game-audio", "org.opencontainers.image.revision"),
            ("game-audio-packager", module.PACKAGER_ROLE),
            ("web-api", "io.gyaruinthemix.checkout-mode"),
        ]:
            updater = self.manifest_updater(mode="api", audio=True)
            updater.bad_component, updater.bad_field = component, field
            with self.assertRaises(module.UpdateError):
                updater.run()
            self.assertEqual(updater.activations, [])

    def test_manifest_health_failure_restores_the_exact_previous_images(self):
        updater = self.manifest_updater(mode="api", audio=True)
        updater.fail_new = True
        with self.assertRaisesRegex(module.UpdateError, "Previous images restored"):
            updater.run()
        self.assertEqual([images for _, images in updater.activations], [updater.desired, updater.current])
        updater.activations.clear()
        with self.assertRaisesRegex(module.UpdateError, "previously failed"):
            updater.run()
        self.assertEqual(updater.activations, [])

    def test_unchanged_release_does_not_recreate_services(self):
        updater = self.manifest_updater(mode="api")
        updater.desired = updater.current.copy()
        updater.run()
        self.assertEqual(updater.activations, [])
        self.assertEqual(json.loads(updater.state_path.read_text())["revision"], "f" * 40)

    def test_legacy_mode_remains_the_default(self):
        self.assertFalse(FakeUpdater(self.directory.name).release_manifest)

    def test_explicit_rollback_selects_the_complete_pinned_manifest(self):
        updater = self.manifest_updater(release_revision="f" * 40)
        updater.run()
        self.assertEqual(updater.pulls[0], module.REGISTRY + "release:sha-" + "f" * 40)
        self.assertEqual(json.loads(updater.state_path.read_text())["revision"], "f" * 40)

    def test_rollback_rejects_a_manifest_for_a_different_release(self):
        updater = self.manifest_updater(release_revision="e" * 40)
        with self.assertRaisesRegex(module.UpdateError, "requested rollback revision"):
            updater.run()
        self.assertEqual(updater.activations, [])


if __name__ == "__main__":
    unittest.main()
