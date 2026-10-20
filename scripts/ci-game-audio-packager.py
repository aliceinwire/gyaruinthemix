#!/usr/bin/env python3
"""GitHub-hosted synthetic contract test of the real bouncer packaging lifecycle."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

assert os.environ.get("GITHUB_ACTIONS") == "true"
assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ci_bouncer_update", ROOT / "deploy/bouncer/update.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
deployment = Path(sys.argv[1]).resolve()
image_id = sys.argv[2]
library = deployment / "gyaruinthemix/assets/music"
output = library / ".hls"
source = library / "ci-synthetic-tone.wav"


class CheckedUpdater(module.Updater):
    def __init__(self):
        super().__init__(deployment)
        self.created = []
        self.create_commands = []
        self.inject_timeout = False

    def packaging_docker(self, *args, timeout=30):
        if args[0] == "wait" and self.inject_timeout:
            # Simulate the host wait reaching its deadline only after the real
            # exact-image container has started. Use production finally cleanup.
            raise subprocess.TimeoutExpired(["docker", *args], timeout)
        result = super().packaging_docker(*args, timeout=timeout)
        if args[0] == "create":
            identifier = result.strip()
            self.created.append(identifier)
            self.create_commands.append(list(args))
            container = json.loads(super().packaging_docker("inspect", identifier))[0]
            host = container["HostConfig"]
            assert container["Image"] == image_id
            assert container["Config"]["User"] == f"{os.geteuid()}:10001"
            assert host["ReadonlyRootfs"] is True
            assert host["Privileged"] is False
            assert host["NetworkMode"] == "none"
            assert host["CapDrop"] == ["ALL"]
            assert "no-new-privileges:true" in host["SecurityOpt"]
            assert host["Memory"] == host["MemorySwap"] == 192 * 1024 ** 2
            assert host["NanoCpus"] == 500000000
            assert host["PidsLimit"] == 64
            assert host["LogConfig"]["Type"] == "none"
            assert host["RestartPolicy"]["Name"] == "no"
            assert not host.get("PortBindings")
            assert host["Tmpfs"] == {"/tmp": "rw,noexec,nosuid,nodev,size=32m,mode=1777"}
            assert {item["Name"]: (item["Soft"], item["Hard"]) for item in host["Ulimits"]} == {
                "core": (0, 0), "nofile": (256, 256)}
            mounts = {item["Destination"]: item for item in container["Mounts"]}
            assert set(mounts) == {"/library/assets/music", "/library/assets/music/.hls"}
            assert mounts["/library/assets/music"]["Source"] == str(library)
            assert mounts["/library/assets/music"]["RW"] is False
            assert mounts["/library/assets/music/.hls"]["Source"] == str(output)
            assert mounts["/library/assets/music/.hls"]["RW"] is True
        return result

    def assert_removed(self):
        for identifier in self.created:
            assert not super().packaging_docker(
                "ps", "--all", "--quiet", "--no-trunc", "--filter", "id=" + identifier).strip()


def original():
    return (hashlib.sha256(source.read_bytes()).hexdigest(), source.stat().st_mtime_ns,
            source.stat().st_mode)


def generated():
    return {str(path.relative_to(output)): (hashlib.sha256(path.read_bytes()).hexdigest(),
                                          path.stat().st_mtime_ns)
            for path in output.rglob("*") if path.is_file() and path.name != "catalog.json"}


updater = CheckedUpdater()
before = original()
updater.package_audio(image_id)
updater.assert_removed()
assert original() == before
catalog = output / "catalog.json"
initial_catalog = catalog.read_bytes()
initial_files = generated()
assert initial_files
updater.package_audio(image_id)
updater.assert_removed()
assert generated() == initial_files, "Unchanged inputs must reuse their encoded packages."
assert catalog.read_bytes() == initial_catalog
assert original() == before

# Real strict failure must preserve the previous catalog and clean its lock/temp.
corrupt = library / "ci-corrupt.mp3"
corrupt.write_bytes(b"PUBLIC_SYNTHETIC_CORRUPT_FIXTURE")
try:
    updater.package_audio(image_id)
except module.UpdateError as error:
    assert "failed" in str(error)
else:
    raise AssertionError("Corrupt synthetic input was accepted.")
updater.assert_removed()
assert catalog.read_bytes() == initial_catalog
assert not (output / ".packaging.lock").exists()
assert not list(output.glob(".building-*"))
assert original() == before

# The same strict invalid input prevents promotion even if packaging finishes
# before the injected wait timeout. Abrupt termination may deliberately retain
# a lock for operator inspection; never treat an unconfirmed run as success.
updater.inject_timeout = True
try:
    updater.package_audio(image_id)
except module.UpdateError as error:
    assert "deadline" in str(error)
else:
    raise AssertionError("Injected timeout was ignored.")
updater.assert_removed()
assert catalog.read_bytes() == initial_catalog
assert original() == before
corrupt.unlink()

# Replay the captured production confinement with a harmless read-only probe,
# rather than maintaining an independent permissive set of bind/resource flags.
probe = updater.create_commands[0].copy()
probe[0] = "run"
probe[probe.index("--name") + 1] += "-readonly-probe"
restart = probe.index("--restart")
del probe[restart:restart + 2]
probe[1:1] = ["--rm"]
probe[-1:-1] = ["--entrypoint", "node"]
probe += ["--input-type=module", "-e", """
import assert from 'node:assert/strict';
import {appendFile, writeFile, unlink, access} from 'node:fs/promises';
await assert.rejects(appendFile('/library/assets/music/ci-synthetic-tone.wav', 'x'), {code:'EROFS'});
await assert.rejects(writeFile('/library/assets/music/forbidden.wav', 'x'), {code:'EROFS'});
await writeFile('/library/assets/music/.hls/.ci-write-probe', 'synthetic');
await unlink('/library/assets/music/.hls/.ci-write-probe');
await assert.rejects(access('/run/secrets/game_audio_signing_key'));
await assert.rejects(access('/var/run/docker.sock'));
"""]
updater.inject_timeout = False
updater.packaging_docker(*probe, timeout=30)
assert original() == before
print("PASS real bouncer packaging lifecycle: isolated immutable image, cache, strict failure, timeout removal and enforced read-only originals")
