#!/usr/bin/env python3
"""Plan or interactively enable private music in the existing bouncer deployment.

Uses existing Python 3.9+, Git and Docker with Compose; no host Node or FFmpeg.
No installation, Git pull, scheduler editing, privilege escalation or source-file
permission changes. Normal preview is read-only; --prepare-permissions can
remove group-write from reviewed tracked-checkout directories only. Run only from an
operator-reviewed, clean checkout; this is not hostile-local-user isolation.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

# Planning must not even create an import cache in the checkout.
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("bouncer_update", Path(__file__).with_name("update.py"))
update = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(update)
Error = update.UpdateError
WEB, API, AUDIO = update.WEB, update.API, update.AUDIO
JOURNAL = ".bouncer-game-audio-setup.json"
LOCK = ".gyaruinthemix-update.lock"
GROUP = 10001
TOOL_PATH = "/usr/local/bin:/usr/bin:/bin"
MANAGED_ENV = ("GAME_AUDIO_ENABLED", "GAME_AUDIO_SIGNING_KEY_FILE",
               "GYARUINTHEMIX_GAME_AUDIO_IMAGE", "COMPOSE_PROFILES")
REVIEWED = ("deploy/bouncer/setup-audio.py", "deploy/bouncer/update.py",
            "deploy/bouncer/docker-compose.yml", "game-audio/scripts/package-library.mjs")
TRANSACTION_LABEL = "io.gyaruinthemix.audio-setup"
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
# The earlier canonical API service omitted this entire optional membership block.
# Audio setup recognizes that exact layout without adding or enabling its settings.
API_MEMBERSHIP_BLOCK = """      MEMBER_AUTH_ENABLED: ${MEMBER_AUTH_ENABLED:-false}
      MEMBERSHIP_ENABLED: ${MEMBERSHIP_ENABLED:-false}
      MEMBERSHIP_DETAILS_REVIEWED: ${MEMBERSHIP_DETAILS_REVIEWED:-false}
      STRIPE_PRICE_MEMBERSHIP: ${STRIPE_PRICE_MEMBERSHIP:-}
      MEMBERSHIP_AMOUNT_JPY: ${MEMBERSHIP_AMOUNT_JPY:-500}
      MEMBERSHIP_PORTAL_URL: ${MEMBERSHIP_PORTAL_URL:-}
      MEMBER_EMAIL_FROM: ${MEMBER_EMAIL_FROM:-}
      MEMBER_EMAIL_API_KEY_FILE: /app/state/member_email_api_key
      MEMBER_CONTENT_DIR: /app/state/member-content
"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(path, *, exists=False, directory=False):
    """Check every existing component without silently resolving away a symlink."""
    if ".." in Path(path).parts:
        raise Error("Paths containing parent traversal are not supported.")
    path = Path(os.path.abspath(path))
    for component in reversed((path, *path.parents)):
        if component.is_symlink():
            raise Error("Refusing a symlink in a deployment, media, backup or key path.")
        if component.exists() and component != path:
            if not component.is_dir():
                raise Error("A required path ancestor is not a directory.")
            info = component.stat()
            sticky_root = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
            if info.st_uid not in (0, os.geteuid()) or (info.st_mode & 0o022 and not sticky_root):
                raise Error(
                    "Deployment/key/media ancestry must be root- or deployment-user-owned and not group/world writable. "
                    f"Offending ancestor: {str(component)!r}; owner UID={info.st_uid}; "
                    f"mode={stat.S_IMODE(info.st_mode):04o}; "
                    f"expected owner UID=0 (root) or {os.geteuid()} (deployment user).")
    if exists and not path.exists():
        raise Error("A required deployment path is missing.")
    if path.exists() and (not path.is_dir() if directory else not path.is_file()):
        raise Error("A deployment path has an unexpected file type.")
    return path


def inside_git(path):
    return any((ancestor / ".git").exists() or (ancestor / ".git").is_symlink()
               for ancestor in (Path(path), *Path(path).parents))


def private_file(path):
    path = safe_path(path, exists=True)
    info = path.stat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077 or info.st_nlink != 1:
        raise Error("Recovery files must be private, singly linked and owned by the deployment user.")
    return path


def validate_dotenv(text):
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)", line)
        if not match:
            raise Error("Multiline or unsupported .env syntax requires local review before setup.")
        value = match.group(1).lstrip()
        if value.startswith("'") and not re.fullmatch(r"'[^']*'\s*(?:#.*)?", value):
            raise Error("Multiline .env values are not supported by this narrow migration.")
        if value.startswith('"') and not re.fullmatch(r'"(?:[^"\\]|\\.)*"\s*(?:#.*)?', value):
            raise Error("Multiline .env values are not supported by this narrow migration.")


def dotenv_value(text, key, default=""):
    validate_dotenv(text)
    lines = [line for line in text.splitlines()
             if re.match(r"^\s*(?:export\s+)?" + re.escape(key) + r"\s*=", line)]
    if len(lines) > 1:
        raise Error(f"Duplicate {key} settings require local review.")
    if not lines:
        return default
    value = lines[0].split("=", 1)[1].strip()
    match = re.fullmatch(r"(?:'([^'\r\n]*)'|\"([^\"\r\n]*)\"|([^#'\"\r\n]*?))(?:\s+#.*)?", value)
    if not match:
        raise Error(f"Unsupported quoting in {key}; review it locally.")
    result = next((part for part in match.groups() if part is not None), "").strip()
    if any(character in result for character in "$`\\\r\n"):
        raise Error(f"Interpolated or escaped {key} is not safe to change automatically.")
    return result


def change_dotenv(text, changes):
    """Replace only selected values, preserving every other byte and inline comments."""
    for key, value in changes.items():
        dotenv_value(text, key)  # Reject duplicate or ambiguous assignments first.
        if not re.fullmatch(r"[A-Za-z0-9_./,:@+-]+", value):
            raise Error("A setup setting contains unsupported characters; use a simple absolute key path.")
        pattern = re.compile(r"^(\s*(?:export\s+)?" + re.escape(key) + r"\s*=)([^\r\n]*)(\r?\n|$)", re.M)
        def replace(match):
            parsed = re.fullmatch(r"\s*(?:'[^']*'|\"[^\"]*\"|[^#'\"\r\n]*?)(\s+#.*)?", match.group(2))
            comment = parsed.group(1) if parsed else None
            return match.group(1) + value + (comment or "") + match.group(3)
        if pattern.search(text):
            text = pattern.sub(replace, text)
        else:
            newline = "\r\n" if "\r\n" in text else "\n"
            text += (newline if text and not text.endswith("\n") else "") + f"{key}={value}" + newline
    return text


def section(text, name):
    starts = list(re.finditer(r"^" + re.escape(name) + r":\s*(?:#.*)?\n", text, re.M))
    if len(starts) != 1:
        raise Error(f"Installed Compose needs one ordinary {name} mapping; review local drift.")
    start = starts[0].end()
    following = re.search(r"^[^ #\t\n][^\n]*:", text[start:], re.M)
    return start, start + following.start() if following else len(text)


def entry(text, parent, name):
    start, end = section(text, parent)
    entries = list(re.finditer(r"^  ([A-Za-z0-9_-]+):[^\n]*\n", text[start:end], re.M))
    matches = [i for i, item in enumerate(entries) if item.group(1) == name]
    if len(matches) > 1:
        raise Error("Duplicate Compose definitions require local review.")
    if not matches:
        return None
    index = matches[0]
    return start + entries[index].start(), start + entries[index + 1].start() if index + 1 < len(entries) else end


def normalized(block):
    return "\n".join(line.rstrip() for line in block.splitlines() if line.strip() and not line.lstrip().startswith("#"))


def _merge_compose(installed, canonical):
    """A narrow text migration, not a YAML reserializer or a second Compose file."""
    result = installed
    for name in (WEB, API):
        old, new = entry(result, "services", name), entry(canonical, "services", name)
        if old is None or new is None:
            raise Error("Set up the canonical website first; no existing website service was found.")
        actual, target = result[slice(*old)], canonical[slice(*new)]
        legacy = "\n".join(line for line in target.splitlines()
                           if "GAME_AUDIO_ENABLED:" not in line and "Resolved by the installed updater" not in line)
        recognized = {normalized(target), normalized(legacy)}
        if name == API and target.count(API_MEMBERSHIP_BLOCK) == 1:
            recognized.add(normalized(target.replace(API_MEMBERSHIP_BLOCK, "", 1)))
        if normalized(actual) not in recognized:
            raise Error(f"Unrecognized local {name} drift; reconcile it with the reviewed canonical file first.")
        if name == WEB and "GAME_AUDIO_ENABLED:" not in actual:
            anchor = "      ENABLE_HTTP_ON_MISSING_CERT: 'false'\n"
            if actual.count(anchor) != 1:
                raise Error("Unrecognized web environment layout; refusing to overwrite local Compose.")
            actual = actual.replace(anchor, anchor + "      GAME_AUDIO_ENABLED: ${GAME_AUDIO_ENABLED:-false}\n")
            result = result[:old[0]] + actual + result[old[1]:]
    for parent, name in (("services", AUDIO), ("secrets", update.AUDIO_SECRET)):
        target_range = entry(canonical, parent, name)
        target = canonical[slice(*target_range)]
        old = entry(result, parent, name)
        if old:
            if normalized(result[slice(*old)]) != normalized(target):
                raise Error("Unrecognized local audio definition; refusing to overwrite it.")
        else:
            _, end = section(result, parent)
            result = result[:end].rstrip("\n") + "\n\n" + target.rstrip("\n") + "\n\n" + result[end:]
    return result


def merge_compose(installed, canonical):
    newline = "\r\n" if "\r\n" in installed else "\n"
    if newline == "\r\n" and "\n" in installed.replace("\r\n", ""):
        raise Error("Mixed Compose line endings require local review.")
    result = _merge_compose(installed.replace("\r\n", "\n"), canonical.replace("\r\n", "\n"))
    return result.replace("\n", newline)


def fingerprint(info):
    """Identity and metadata for detecting operator edits or replacement races."""
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def tracked_name(filename):
    parts = filename.split("/")
    if (not filename or any(part in ("", ".", "..") or part.casefold() == ".git" for part in parts)
            or "\\" in filename or any(ord(char) < 32 or ord(char) == 127 for char in filename)
            or parts[:2] == ["assets", "music"]):
        raise Error("Unsafe tracked path or tracked private music; review the checkout before setup.")
    return filename


def metadata(path):
    info = path.stat()
    return {"mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path, data, attributes=None):
    safe_path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".audio-setup-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            if attributes:
                os.fchown(output.fileno(), attributes["uid"], attributes["gid"])
                os.fchmod(output.fileno(), attributes["mode"])
            else:
                os.fchmod(output.fileno(), 0o600)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class AudioSetup(update.Updater):
    def __init__(self, directory, key_file=None):
        directory = safe_path(directory, exists=True, directory=True)
        super().__init__(directory)
        # Installed .env is authoritative, never a transient shell routing/image override.
        self.env = {key: self.env[key] for key in ("HOME", "DOCKER_CONFIG", "XDG_RUNTIME_DIR") if key in self.env}
        self.env.update({"PATH": TOOL_PATH, "LANG": "C", "LC_ALL": "C"})
        self.checkout = self.directory / "gyaruinthemix"
        self.library = self.checkout / "assets/music"
        self.hls = self.library / ".hls"
        if "," in str(self.directory) or "\n" in str(self.directory):
            raise Error("The deployment root cannot contain commas or newlines in Docker bind paths.")
        self.journal_path = self.directory / JOURNAL
        self.key_argument = key_file
        # All service definitions must be visible for drift and stopped-container checks.
        self.compose_args += ["--profile", "*"]

    def command(self, args, *, input=None, environment=None):
        result = subprocess.run(args, cwd=self.directory, env=environment or self.env,
                                input=input, text=True, capture_output=True, check=False, timeout=30)
        if result.returncode:
            raise Error(f"{Path(args[0]).name} inspection failed; inspect the host locally (output withheld).")
        return result.stdout

    def git(self, *args):
        return self.command(["git", "--no-optional-locks", "--no-replace-objects", "-c", "core.fsmonitor=false", "-C", str(self.checkout), *args],
                            environment={"PATH": TOOL_PATH, "LANG": "C", "LC_ALL": "C"})

    def reviewed_checkout(self, preparation=None):
        safe_path(self.checkout, exists=True, directory=True)
        if self.git("rev-parse", "--show-toplevel").strip() != str(self.checkout):
            raise Error("The reviewed checkout must be the existing bouncer/gyaruinthemix repository.")
        revision = self.git("rev-parse", "HEAD").strip()
        if not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise Error("Cannot identify the reviewed checkout revision.")
        # Raw objects/index only: status/diff can execute configured clean filters.
        tracked = {}
        for item in self.git("ls-tree", "-r", "-z", "--full-tree", revision).split("\0"):
            if not item:
                continue
            header, filename = item.split("\t", 1)
            mode, kind, blob = header.split()
            if mode not in ("100644", "100755") or kind != "blob":
                raise Error("This setup supports ordinary tracked files only, not symlinks or submodules.")
            tracked_name(filename)
            if filename in tracked or not re.fullmatch(r"[0-9a-f]{40}", blob):
                raise Error("Duplicate or unsupported tracked Git entry; review the checkout.")
            tracked[filename] = (mode, blob)
        index = {}
        raw_index = self.git("ls-files", "--stage", "-z")
        for item in raw_index.split("\0"):
            if not item:
                continue
            header, filename = item.split("\t", 1)
            mode, blob, stage = header.split()
            if stage != "0" or filename in index:
                raise Error("Resolve the checkout index before setup.")
            tracked_name(filename)
            index[filename] = (mode, blob)
        if index != tracked or not set(REVIEWED).issubset(tracked):
            raise Error("The reviewed checkout has staged edits or missing setup files; commit/review them first.")
        descriptors = {}
        try:
            if preparation is not None:
                directories = {self.checkout}
                for filename in tracked:
                    directories.update(parent for parent in (self.checkout / filename).parents
                                       if parent == self.checkout or self.checkout in parent.parents)
                preparation["directories"] = {}
                for path in sorted(directories, key=lambda item: (len(item.parts), str(item))):
                    descriptor = os.open(path if path == self.checkout else path.name,
                                         os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                         **({} if path == self.checkout else {"dir_fd": descriptors[str(path.parent)]}))
                    descriptors[str(path)] = descriptor
                    info = os.fstat(descriptor)
                    mode = stat.S_IMODE(info.st_mode)
                    if info.st_uid != os.geteuid() or mode & 0o002:
                        raise Error(f"Tracked directory must already be deployment-user-owned and not world writable: {str(path)!r}; owner UID={info.st_uid}; mode={mode:04o}.")
                    if path == self.checkout and mode & 0o020:
                        raise Error(f"Provision safe checkout-root permissions separately: {str(path)!r}; mode={mode:04o}. No ancestors or checkout root are changed.")
                    if mode & 0o020 and mode & stat.S_ISGID and info.st_gid not in (os.getegid(), *os.getgroups()):
                        raise Error(f"Cannot preserve setgid on {str(path)!r} without membership in its existing group {info.st_gid}; ask the operator to provision it.")
                    preparation["directories"][str(path)] = fingerprint(info)
                preparation["files"] = {}
            for filename, (mode, expected) in tracked.items():
                path = self.checkout / filename
                if preparation is None:
                    path = safe_path(path, exists=True)
                parent = descriptors.get(str(path.parent))
                descriptor = os.open(path if parent is None else path.name,
                                     os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     **({} if parent is None else {"dir_fd": parent}))
                with os.fdopen(descriptor, "rb") as content:
                    info = os.fstat(content.fileno())
                    if not stat.S_ISREG(info.st_mode) or (preparation is not None and info.st_nlink != 1):
                        raise Error("Tracked files must be ordinary, singly linked non-symlink files before permission preparation.")
                    before = fingerprint(info)
                    checksum = hashlib.sha1(b"blob " + str(info.st_size).encode() + b"\0")
                    for chunk in iter(lambda: content.read(1024 * 1024), b""):
                        checksum.update(chunk)
                    named = (path.lstat() if parent is None else
                             os.stat(path.name, dir_fd=parent, follow_symlinks=False))
                    if fingerprint(os.fstat(content.fileno())) != before or fingerprint(named) != before:
                        raise Error("Tracked file changed during permission planning; review a fresh plan.")
                    if checksum.hexdigest() != expected or bool(info.st_mode & 0o111) != (mode == "100755"):
                        raise Error("Tracked checkout bytes/modes differ from HEAD (including filters/line-ending conversions); review them before setup.")
                    if preparation is not None:
                        preparation["files"][filename] = before
            if preparation is not None:
                self.verify_permission_snapshot(preparation, descriptors)
            if (self.git("rev-parse", "HEAD").strip() != revision or
                    self.git("ls-files", "--stage", "-z") != raw_index):
                raise Error("Checkout revision/index changed during inspection; review a fresh plan.")
        finally:
            for descriptor in descriptors.values():
                os.close(descriptor)
        if Path(__file__).absolute() != self.checkout / "deploy/bouncer/setup-audio.py":
            raise Error("Run the setup command from this deployment's reviewed checkout, not a copied script.")
        if self.git("ls-files", "--", "assets/music").strip():
            raise Error("Private music must not be tracked in Git.")
        self.git("check-ignore", "--no-index", "assets/music/.setup-ignore-check")
        return revision

    def verify_permission_snapshot(self, plan, descriptors):
        for name, before in plan["directories"].items():
            path = Path(name)
            named = (path.lstat() if path == self.checkout else
                     os.stat(path.name, dir_fd=descriptors[str(path.parent)], follow_symlinks=False))
            if fingerprint(named) != before or fingerprint(os.fstat(descriptors[name])) != before:
                raise Error("A tracked directory changed after planning; review a fresh permission plan.")
        for filename, before in plan["files"].items():
            path = self.checkout / filename
            info = os.stat(path.name, dir_fd=descriptors[str(path.parent)], follow_symlinks=False)
            if fingerprint(info) != before:
                raise Error("A tracked file changed after planning; no unreviewed changes are accepted.")

    def permission_plan(self):
        """Finite tracked-checkout ancestry only; never scan untracked/media/Git trees."""
        if sys.version_info < (3, 9) or sys.platform != "linux":
            raise Error("Use existing Python 3.9+ on Linux; nothing is installed automatically.")
        self.validate_packaging_user()
        if not shutil.which("git", path=TOOL_PATH):
            raise Error("Existing git is required; nothing is installed automatically.")
        # Require safe host/checkout ancestry, but do not broaden what may be chmodded.
        safe_path(self.checkout / ".git", exists=True, directory=True)
        update.guard_pending(self.directory, "permission-preparation")
        gitdir = self.checkout / ".git"
        # Git metadata remains operator-trusted (including its existing modes).
        # Refuse redirections, linked worktrees, alternate object stores and symlinks.
        for relative, directory in (("", True), ("HEAD", False), ("config", False),
                                    ("index", False), ("objects", True), ("refs", True)):
            path = gitdir / relative
            info = path.lstat()
            if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or (not directory and info.st_nlink != 1):
                raise Error(f"Permission preparation requires ordinary local Git metadata, not symlinks or redirects: {str(path)!r}.")
        for relative in ("commondir", "gitdir", "objects/info/alternates", "info/grafts", "refs/replace"):
            path = gitdir / relative
            for ancestor in (path, *path.parents):
                if ancestor == gitdir:
                    break
                if ancestor.is_symlink():
                    raise Error("Symlinked Git metadata is unsupported for permission preparation.")
            if path.exists():
                raise Error("Linked/alternate/replaced Git storage is unsupported for permission preparation; review locally.")
        if Path(self.git("rev-parse", "--absolute-git-dir").strip()) != gitdir:
            raise Error("Permission preparation requires the checkout's ordinary local .git directory.")
        plan = {}
        plan["revision"] = self.reviewed_checkout(preparation=plan)
        plan["changes"] = [{"path": path, "before": stat.S_IMODE(info[2]),
                            "after": stat.S_IMODE(info[2]) & ~0o020,
                            "uid": info[3], "gid": info[4]}
                           for path, info in plan["directories"].items() if info[2] & 0o020]
        plan["group_access"] = GROUP in (os.getegid(), *os.getgroups())
        return plan

    def show_permission_plan(self, plan):
        print(f"Read-only tracked-directory permission plan for checkout: {str(self.checkout)!r}")
        print(f"Reviewed revision: {plan['revision']}")
        print("All proposed directory changes (remove group-write only; keep owner/group and every other mode bit):")
        for change in plan["changes"]:
            print(f"  {change['path']!r}: {change['before']:04o} -> {change['after']:04o}; UID={change['uid']}; GID={change['gid']}")
        if not plan["changes"]:
            print("  None. Tracked checkout directory permissions already satisfy this preparation step.")
        print("No recursion, file chmod, ownership/group changes, keys, installs, pulls or deployment. The private assets/music subtree, .git, untracked/unrelated directories and host ancestors are excluded. Tracked site-image directory ancestors may be listed; no asset/media file is changed.")
        print("Remaining audio prerequisites (not provisioned or fully checked by this directory-only plan):")
        print("  Host: safe root/home/deployment/checkout ancestry and private backup home outside Git; existing Python 3.9+, Git, local rootful amd64 Docker/Compose and sufficient resources.")
        for filename in REVIEWED[:3]:  # Host setup/updater/Compose, not the image-only packager.
            info = plan["files"][filename]
            if info[2] & 0o022 or info[3] != os.geteuid():
                print(f"  Source-file access review: {str(self.checkout / filename)!r}; owner UID={info[3]}; mode={stat.S_IMODE(info[2]):04o}. Operator trust review only, not an enforced leaf-mode blocker; file permissions are NOT changed.")
        print("  Runtime files: installed .env/Compose and existing updater state/catalog must already have safe owner, group and non-group/world-writable modes; no runtime file permissions are changed.")
        print("  Key/media: dedicated private key directory outside Git (0750), valid private key (typically 0640), library (0750) and generated .hls (2750), with group 10001 access; originals stay private.")
        print("  GID 10001: " + ("current account has membership; normal setup still validates actual access." if plan["group_access"] else "MISSING from current account. An operator must provision group/access prerequisites before audio setup can create a key or adjust dedicated directory groups; this command never changes accounts."))
        print("The running entrypoint and Git metadata must already be operator-reviewed/trusted; this preparation is not hostile-local-user isolation.")
        print("Run normal setup preview afterward for the full host/runtime/key/media checks. No permissions have changed in this plan.")

    def apply_permissions(self, plan):
        """Use anchored no-follow descriptors; preserve bytes, owner/group and file modes."""
        descriptors = {}
        expected = dict(plan["directories"])
        changed = []
        attempted = []
        def verify():
            self.verify_permission_snapshot({**plan, "directories": expected}, descriptors)
        try:
            for name in expected:
                path = Path(name)
                descriptor = os.open(path if path == self.checkout else path.name,
                                     os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     **({} if path == self.checkout else {"dir_fd": descriptors[str(path.parent)]}))
                descriptors[name] = descriptor
            verify()  # Validate every path before changing even the first one.
            for change in plan["changes"]:  # Shallowest first: secure parents before children.
                verify()
                descriptor = descriptors[change["path"]]
                attempted.append(change["path"])
                os.fchmod(descriptor, change["after"])
                changed.append(change["path"])
                info = os.fstat(descriptor)
                if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (change["uid"], change["gid"], change["after"]):
                    raise Error("Could not preserve the approved directory owner/group/mode; inspect it locally.")
                expected[change["path"]] = fingerprint(info)
                os.fsync(descriptor)
            verify()
        except BaseException:
            # A signal may arrive between fchmod and bookkeeping. Inspect held FDs
            # so the partial-progress report includes every observed mode change.
            changed = [item["path"] for item in plan["changes"]
                       if item["path"] in attempted and item["path"] in descriptors and
                       stat.S_IMODE(os.fstat(descriptors[item["path"]]).st_mode) != item["before"]]
            print("Permission preparation stopped. Already changed directories: " + (", ".join(repr(path) for path in changed) or "none") + ". Safe completed changes are retained; inspect and rerun the read-only plan.", file=sys.stderr)
            raise
        finally:
            for descriptor in descriptors.values():
                os.close(descriptor)
        print(f"Prepared {len(changed)} tracked checkout directories only. File bytes/modes and owner/group are unchanged. Run normal setup preview next; audio is not enabled.")

    def dependencies(self):
        if sys.version_info < (3, 9) or sys.platform != "linux":
            raise Error("Use existing Python 3.9+ on Linux; nothing is installed automatically.")
        self.validate_packaging_user()
        for name in ("git", "docker"):
            executable = shutil.which(name, path=TOOL_PATH)
            if not executable:
                raise Error(f"Existing {name} is required; setup never installs software. Node and FFmpeg run only inside the release packager image.")
        # Bound the one-shot helper before any private key/config mutation.
        # Recovery keeps its narrower local-daemon check: it does not package.
        self.validate_packaging_docker()
        self.command(["docker", "compose", "version"])

    def local_docker(self):
        context = json.loads(self.docker("context", "inspect"))[0]
        if not context["Endpoints"]["docker"]["Host"].startswith("unix://"):
            raise Error("Use the existing local Docker context, not a remote daemon.")
        if self.docker("info", "--format", "{{.Architecture}}").strip() not in ("amd64", "x86_64"):
            raise Error("Published audio images require the local amd64 Docker host.")
        security = json.loads(self.docker("info", "--format", "{{json .SecurityOptions}}")) or []
        if any("rootless" in option or "userns" in option for option in security):
            raise Error("Rootless or user-namespace-remapped Docker requires an operator-reviewed UID/GID mapping; automatic audio permissions are not supported.")

    def config_document(self, document, changes):
        environment = {**self.env, **changes}
        command = ["docker", "compose", "--project-directory", str(self.directory),
                   "--env-file", str(self.directory / ".env"), "-f", "-", "--profile", "*",
                   "config", "--format", "json"]
        return json.loads(self.command(command, input=document, environment=environment))

    def permissions(self, key):
        """Plan only narrowly scoped owner/group changes. Never recurse into originals."""
        changes = []
        for path, mode in ((key.parent, 0o750), (self.library, 0o750), (self.hls, 0o2750)):
            safe_path(path, directory=True)
            if not path.exists():
                parent = self.library.parent if path == self.hls and not self.library.exists() else path.parent
                if not parent.is_dir() or not os.access(parent, os.W_OK | os.X_OK):
                    raise Error("Provision the dedicated key parent or assets directory with deployment-user write access first; no ancestor directories are created or chmodded.")
                before = None
            else:
                before = metadata(path)
            if before and path in (self.library, self.hls) and before["uid"] != os.geteuid():
                raise Error("The existing deployment user must own the private library and .hls directories; setup never adopts a different owner.")
            desired = {"mode": mode, "uid": before["uid"] if before else os.geteuid(), "gid": GROUP}
            if before and (path == self.hls or path == self.library or (path == key.parent and not key.exists())) and not os.access(path, os.W_OK | os.X_OK):
                raise Error("The deployment user needs write/traverse access to the dedicated output/key directories; pre-provision it before setup.")
            if before != desired:
                if path == key.parent and before and any(child != key for child in path.iterdir()):
                    raise Error("The key directory contains unrelated files; pre-provision its access or choose a dedicated empty directory. Setup never chmods a shared directory.")
                if before and os.geteuid() not in (0, before["uid"]):
                    raise Error("The deployment user must own the dedicated key/library/.hls directories before setup can adjust them.")
                if os.geteuid() != 0 and GROUP not in (os.getegid(), *os.getgroups()):
                    raise Error("The deployment user needs existing group 10001 membership, or an operator must pre-provision the dedicated directories with group 10001 and modes 0750 (key/library) and 2750 (.hls). Setup never changes accounts or escalates privileges.")
                changes.append({"path": str(path), "before": before, "after": desired})
        if key.exists():
            info = key.stat()
            mode = stat.S_IMODE(info.st_mode)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size < 32 or
                    mode & 0o007 or mode & 0o022 or
                    not ((info.st_uid == GROUP and mode & 0o400) or (info.st_gid == GROUP and mode & 0o040))):
                raise Error("Existing key is not safe/readable: require a singly linked regular file of at least 32 bytes, no other-user access or group write, and UID/GID 10001 read access. Setup never overwrites an existing key.")
        elif os.geteuid() != 0 and GROUP not in (os.getegid(), *os.getgroups()):
            raise Error("Creating the private key requires existing permission to assign group 10001; ask the operator to provision access first.")
        # A prior package must already have safe group access; never recursively chmod it.
        if self.hls.exists():
            if (self.hls / ".packaging.lock").exists():
                raise Error("Inspect the existing packaging lock locally; setup never removes it blindly.")
            for parent, directories, files in os.walk(self.hls, followlinks=False):
                for name in directories + files:
                    path = safe_path(Path(parent) / name, exists=True, directory=name in directories)
                    info = path.stat()
                    required = 0o050 if path.is_dir() else 0o040
                    if (info.st_uid != os.geteuid() or info.st_gid != GROUP or
                            (path.is_file() and info.st_nlink != 1) or
                            stat.S_IMODE(info.st_mode) & 0o027 or stat.S_IMODE(info.st_mode) & required != required):
                        raise Error("Existing generated .hls entries need deployment ownership, safe single links and reviewed group-10001 access; setup does not recursively change permissions.")
        return changes

    def capture(self, config, selected):
        baselines = {}
        for name in config["services"]:
            identifier = self.docker("ps", "-aq", "--filter", f"label=com.docker.compose.project={config['name']}",
                                     "--filter", f"label=com.docker.compose.service={name}").strip()
            if "\n" in identifier:
                raise Error("Setup supports one container per service; inspect scaled or duplicate services first.")
            if not identifier:
                if name in selected and name != AUDIO:
                    raise Error("Start the existing website/API healthy before audio setup.")
                baselines[name] = None
                continue
            container = json.loads(self.docker("inspect", identifier))[0]
            labels = container.get("Config", {}).get("Labels", {})
            if labels.get("com.docker.compose.project") != config["name"] or labels.get("com.docker.compose.service") != name:
                raise Error("A container belongs to a different Compose project/service; refusing to adopt it.")
            state = container.get("State", {})
            if name in selected and (not state.get("Running") or state.get("Restarting") or state.get("Health", {}).get("Status") != "healthy"):
                raise Error("Existing website/API/audio containers must be healthy, including stopped audio containers.")
            if name == API and API not in selected and state.get("Running"):
                raise Error("An API is running in Payment Links mode; finish the existing mode migration first.")
            if name == AUDIO and config["services"][WEB].get("environment", {}).get("GAME_AUDIO_ENABLED", "false") != "true":
                raise Error("An audio container already exists while audio is disabled; finish its recovery/deactivation first.")
            if not IMAGE_ID.fullmatch(container.get("Image", "")):
                raise Error("Cannot identify an existing rollback image.")
            baselines[name] = {"id": identifier, "image": container["Image"],
                               "restarts": container.get("RestartCount", 0), "started": state.get("StartedAt")}
        # A pre-audio installed Compose does not yet contain the sidecar definition.
        baselines.setdefault(AUDIO, None)
        return baselines

    def plan(self):
        if self.journal_path.exists():
            pending = self.read_journal()
            if pending["pending"]:
                raise Error("Interrupted audio setup needs --recover (plan), then --recover --apply. Do not delete its journal.")
        update.guard_pending(self.directory, "game-audio-setup")
        self.dependencies()
        revision = self.reviewed_checkout()
        compose_path = safe_path(self.directory / "docker-compose.yml", exists=True)
        env_path = safe_path(self.directory / ".env", exists=True)
        for path in (compose_path, env_path):
            if path.stat().st_uid != os.geteuid() or path.stat().st_nlink != 1 or stat.S_IMODE(path.stat().st_mode) & ~0o755 or path.stat().st_mode & 0o022:
                raise Error("Installed Compose and .env must be singly linked, deployment-user-owned, and not group/world writable.")
        installed = compose_path.read_bytes().decode()
        env_text = env_path.read_bytes().decode()
        for key in (*MANAGED_ENV, "CHECKOUT_MODE", "COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "GYARUINTHEMIX_WEB_IMAGE", "GYARUINTHEMIX_API_IMAGE"):
            dotenv_value(env_text, key)
        if dotenv_value(env_text, "COMPOSE_FILE"):
            raise Error("Remove/reconcile COMPOSE_FILE overrides first; only the canonical installed file is supported.")
        home = safe_path(Path.home(), exists=True, directory=True)
        if inside_git(home):
            raise Error("Private setup backups require a home directory outside every Git working tree; arrange a safe deployment account home first.")
        if home.stat().st_uid != os.geteuid() or home.stat().st_mode & 0o022:
            raise Error("Private backup parent must be deployment-user-owned and not group/world writable.")
        if os.geteuid() != 0 and any(path.stat().st_gid not in (os.getegid(), *os.getgroups()) for path in (compose_path, env_path)):
            raise Error("The deployment user cannot preserve the current config group; pre-provision ownership/group access first.")
        if dotenv_value(env_text, "GAME_AUDIO_ENABLED") not in ("", "true", "false"):
            raise Error("Existing GAME_AUDIO_ENABLED must be exactly true or false; review the configuration first.")
        if dotenv_value(env_text, "GYARUINTHEMIX_GAME_AUDIO_IMAGE") not in ("", update.REGISTRY + "game-audio:main"):
            raise Error("An existing audio image override differs from the canonical :main reference; refusing to overwrite it.")
        canonical = (self.checkout / "deploy/bouncer/docker-compose.yml").read_text()
        candidate = merge_compose(installed, canonical)
        mode = dotenv_value(env_text, "CHECKOUT_MODE", "payment_links")
        if mode not in ("payment_links", "api"):
            raise Error("Unsupported checkout mode; audio setup never changes checkout mode.")
        profiles = [value.strip() for value in dotenv_value(env_text, "COMPOSE_PROFILES").split(",") if value.strip()]
        if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value) for value in profiles):
            raise Error("Unsupported Compose profile syntax.")
        if (mode == "api") != ("checkout-api" in profiles):
            raise Error("CHECKOUT_MODE and checkout-api profile disagree; resolve the existing mode before audio setup.")
        if "game-audio" not in profiles:
            profiles.append("game-audio")
        key_value = self.key_argument or dotenv_value(env_text, "GAME_AUDIO_SIGNING_KEY_FILE") or str(Path.home() / ".gyaruinthemix-secrets/game_audio_signing_key")
        if not Path(key_value).is_absolute() or str(Path(key_value)) != key_value or ".." in Path(key_value).parts:
            raise Error("The key path must be absolute and normalized.")
        key = safe_path(key_value)
        if key.resolve() != key:
            raise Error("Use a normalized non-symlink key path.")
        if key == self.checkout or self.checkout in key.parents or key.parent in (self.directory, Path("/")):
            raise Error("Use a dedicated key directory outside the checkout, not a shared deployment/root directory.")
        if inside_git(key.parent):
            raise Error("The signing key must be outside every Git working tree, including a parent deployment repository.")
        if key.parent in (Path.home(), self.directory, self.checkout.parent, Path("/tmp"), Path("/srv"), Path("/etc")):
            raise Error("Use a dedicated private key directory, never a home, deployment or shared system directory.")
        # A key override may select a new location, but never move or copy a key.
        changes = {"GAME_AUDIO_ENABLED": "true", "GAME_AUDIO_SIGNING_KEY_FILE": str(key),
                   "GYARUINTHEMIX_GAME_AUDIO_IMAGE": update.REGISTRY + "game-audio:main",
                   "COMPOSE_PROFILES": ",".join(profiles)}
        new_env = change_dotenv(env_text, changes)
        before = self.config_document(installed, {})
        after = self.config_document(candidate, changes)
        expected = {WEB: update.REGISTRY + ("web-api" if mode == "api" else "web") + ":main", AUDIO: update.REGISTRY + "game-audio:main"}
        if mode == "api":
            expected[API] = update.REGISTRY + "api:main"
        for name, image in expected.items():
            if after["services"][name]["image"] != image:
                raise Error("Audio setup requires the documented matching GHCR :main settings; reconcile image overrides first.")
        if before["services"][WEB].get("build", {}).get("args", {}).get("CHECKOUT_MODE", "payment_links") != mode:
            raise Error("Installed Compose does not use the selected checkout mode.")
        def unrelated(config):
            result = copy.deepcopy(config)
            result["services"].pop(AUDIO, None)
            result.get("secrets", {}).pop(update.AUDIO_SECRET, None)
            result["services"][WEB].get("environment", {}).pop("GAME_AUDIO_ENABLED", None)
            return result
        if unrelated(before) != unrelated(after):
            raise Error("Candidate configuration changes the project or non-audio services; refusing local drift.")
        safe_path(self.checkout / "assets", exists=True, directory=True)
        permission_changes = self.permissions(key)
        for path in (self.state_path, self.hls / "catalog.json"):
            if path.exists():
                safe_path(path, exists=True)
                info = path.stat()
                if info.st_uid != os.geteuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & ~0o755 or info.st_mode & 0o022 or (os.geteuid() != 0 and info.st_gid not in (os.getegid(), *os.getgroups())):
                    raise Error("Existing updater state/catalog must have deployment-user ownership and a preservable safe group/mode before setup.")
        # Query even an absent/stopped sidecar by exact project labels, without requiring
        # that its definition already existed in the old installed Compose file.
        before["services"].setdefault(AUDIO, after["services"][AUDIO])
        baselines = self.capture(before, expected)
        previous = {name: record["image"] for name, record in baselines.items() if name in expected and record}
        return {"revision": revision, "mode": mode, "key": str(key), "key_exists": key.exists(),
                "compose_before": installed, "compose_after": candidate, "env_before": env_text, "env_after": new_env,
                "changes": changes, "config": after, "old_config": before, "expected": expected,
                "permissions": permission_changes, "baselines": baselines, "previous": previous}

    def show_plan(self, plan):
        print(f"Read-only plan: existing {plan['mode']} checkout, reviewed candidate revision {plan['revision']}.")
        print(f"Deployment root (--directory): {self.directory} (installed docker-compose.yml and .env).")
        print(f"Private music input: {self.library}; generated output: {self.hls}.")
        print("Use the deployment root for --directory, not the nested music directory.")
        print("Selected containers: " + ", ".join(plan["expected"]))
        print("Preserve this Compose project, shared services, unrelated profiles and .env comments.")
        print("Reuse the existing private key." if plan["key_exists"] else "Create a new private 32-byte key outside the checkout; never print it.")
        print(f"Private key destination: {plan['key']}")
        for change in plan["permissions"]:
            print(f"Dedicated directory: {change['path']} -> group {GROUP}, mode {change['after']['mode']:04o} (no recursive changes).")
        print(f"Private backups: {Path.home()}/.bouncer-audio-backup-<transaction>/ (0700 directory, 0600 files).")
        print("After confirmation: pull and verify matching SHA-tagged service and one-shot packager images before changing keys/config,")
        print("then back up config, apply only reviewed audio settings/permissions, package with the immutable release image,")
        print("and health-check only selected website/API/audio containers. The helper is not a serving Compose service.")
        print("Host requirements: existing Python 3.9+, Git and Docker with Compose; no host Node, FFmpeg or package installation.")
        print("Keep cron/systemd unchanged; the common updater lock and recovery journal protect this transaction.")
        print(f"Free deployment-filesystem space: {shutil.disk_usage(self.directory).free // (1024 ** 2)} MiB. Review memory/disk headroom before applying.")
        print("No files, permissions, keys, images or containers have been changed by this plan.")

    def prepare_images(self, plan):
        images = {}
        for name, reference in plan["expected"].items():
            release = reference.removesuffix(":main") + ":sha-" + plan["revision"]
            try:
                self.docker("pull", release)
            except Error:
                raise Error("Published release pull failed. Verify this revision finished publication and existing GHCR access/package visibility locally; setup does not request credentials or change visibility. No configuration changed.") from None
            image = json.loads(self.docker("image", "inspect", release))[0]
            labels = image.get("Config", {}).get("Labels") or {}
            if (labels.get("org.opencontainers.image.source") != update.SOURCE or
                    labels.get("org.opencontainers.image.revision") != plan["revision"] or
                    (name == WEB and labels.get("io.gyaruinthemix.checkout-mode") != plan["mode"]) or
                    not IMAGE_ID.fullmatch(image.get("Id", ""))):
                raise Error("A selected image does not match the reviewed published release/source/mode; no configuration changed.")
            images[name] = image["Id"]
        # The helper is prepared for exactly the same reviewed SHA, but is never
        # a serving service, activation target or rollback/journal baseline.
        packager_image = self.prepare_packager(plan["revision"])
        return images, packager_image

    def check_baselines(self, plan):
        if self.capture(plan["old_config"], plan["expected"]) != plan["baselines"]:
            raise Error("A container changed while setup was preparing; inspect concurrent operator work before continuing.")
        if safe_path(self.directory / "docker-compose.yml", exists=True).read_bytes().decode() != plan["compose_before"] or safe_path(self.directory / ".env", exists=True).read_bytes().decode() != plan["env_before"]:
            raise Error("Installed configuration changed during preparation; refusing to overwrite operator edits.")

    def write_journal(self, state):
        atomic_write(self.journal_path, (json.dumps(state, sort_keys=True) + "\n").encode())

    def snapshot(self, plan, images):
        backup = Path.home() / (".bouncer-audio-backup-" + uuid.uuid4().hex)
        backup.mkdir(mode=0o700)
        sync_directory(backup.parent)
        state = {"version": 1, "pending": True, "phase": "prepared", "backup": str(backup),
                 "project": plan["config"]["name"], "previous": plan["previous"], "images": images,
                 "revision": plan["revision"], "files": {}, "outputs": {},
                 "baselines": {name: plan["baselines"][name] for name in images}}
        for name, before, after in (("docker-compose.yml", plan["compose_before"], plan["compose_after"]),
                                    (".env", plan["env_before"], plan["env_after"])):
            path = self.directory / name
            atomic_write(backup / name, before.encode())
            state["files"][name] = {"before": digest(before.encode()), "after": digest(after.encode()), **metadata(path)}
        for name, path in (("website-state", self.state_path), ("catalog", self.hls / "catalog.json")):
            if path.exists():
                safe_path(path, exists=True)
                data = path.read_bytes()
                atomic_write(backup / name, data)
                state["files"][name] = {"before": digest(data), **metadata(path)}
            else:
                state["files"][name] = None
            state["outputs"][name] = state["files"][name]["before"] if state["files"][name] else None
        self.write_journal(state)  # Durable before permissions, key or config mutations.
        return state

    def provision(self, plan):
        for change in plan["permissions"]:
            path = safe_path(change["path"], directory=True)
            if change["before"] is None:
                path.mkdir(mode=0o700)
                sync_directory(path.parent)
            elif metadata(path) != change["before"]:
                raise Error("Directory ownership/permissions changed after planning; stopped before replacing them.")
            os.chown(path, change["after"]["uid"], GROUP)
            os.chmod(path, change["after"]["mode"])
            sync_directory(path)
        key = safe_path(plan["key"])
        if not plan["key_exists"]:
            # O_EXCL means an existing key is never truncated, even after a race or crash.
            descriptor = os.open(key, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                # CSPRNG bytes exist only in this private descriptor, never stdout/journal/Git.
                with os.fdopen(descriptor, "wb") as output:
                    output.write(os.urandom(32))
                    os.fchown(output.fileno(), os.geteuid(), GROUP)
                    os.fchmod(output.fileno(), 0o640)
                    output.flush()
                    os.fsync(output.fileno())
                sync_directory(key.parent)
            except BaseException:
                # Keep any file private for operator inspection; never overwrite it on retry.
                raise

    def read_journal(self):
        state = json.loads(private_file(self.journal_path).read_text())
        if (not isinstance(state, dict) or type(state.get("version")) is not int or state.get("version") != 1 or not isinstance(state.get("pending"), bool) or
                state.get("phase") not in ("prepared", "configured", "packaging", "activating", "complete", "rolled-back") or
                not isinstance(state.get("backup"), str) or
                not re.fullmatch(r"\.bouncer-audio-backup-[0-9a-f]{32}", Path(state["backup"]).name) or
                Path(state["backup"]).parent != Path.home()):
            raise Error("Audio setup journal is invalid; inspect it locally.")
        if set(state) != {"version", "pending", "phase", "backup", "project", "previous", "images", "revision", "files", "outputs", "baselines"}:
            raise Error("Audio setup journal has unrecognized fields.")
        if state["pending"] != (state["phase"] not in ("complete", "rolled-back")) or not isinstance(state.get("revision"), str) or not re.fullmatch(r"[0-9a-f]{40}", state["revision"]):
            raise Error("Audio setup recovery phase/revision is invalid.")
        backup = safe_path(state["backup"], exists=True, directory=True)
        if metadata(backup) != {"mode": 0o700, "uid": os.geteuid(), "gid": backup.stat().st_gid}:
            raise Error("Audio setup backup directory is not private and deployment-user-owned.")
        if not isinstance(state.get("project"), str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", state["project"]):
            raise Error("Audio setup project identity is invalid.")
        for field in ("previous", "images"):
            images = state.get(field)
            if not isinstance(images, dict) or not set(images).issubset({WEB, API, AUDIO}) or WEB not in images or any(not isinstance(value, str) or not IMAGE_ID.fullmatch(value) for value in images.values()):
                raise Error("Audio setup rollback image state is invalid.")
        if set(state["images"]) != set(state["previous"]) | {AUDIO}:
            raise Error("Audio setup service selection is invalid.")
        if not isinstance(state.get("files"), dict) or set(state["files"]) != {"docker-compose.yml", ".env", "website-state", "catalog"}:
            raise Error("Audio setup backup inventory is invalid.")
        for name, record in state["files"].items():
            if record is not None:
                if (not isinstance(record, dict) or type(record.get("mode")) is not int or
                        not 0 <= record["mode"] <= 0o777 or type(record.get("uid")) is not int or
                        type(record.get("gid")) is not int or record["gid"] < 0 or
                        record["uid"] != os.geteuid() or record["mode"] & 0o022):
                    raise Error("Audio setup backup permissions are invalid.")
                fields = {"before", "mode", "uid", "gid"} | ({"after"} if name in ("docker-compose.yml", ".env") else set())
                if set(record) != fields or any(not isinstance(record.get(field), str) or not re.fullmatch(r"[0-9a-f]{64}", record[field]) for field in ("before", "after") if field in fields):
                    raise Error("Audio setup backup fingerprints are invalid.")
                if digest(private_file(backup / name).read_bytes()) != record.get("before"):
                    raise Error("An audio setup backup changed; refusing automatic recovery.")
            elif name in ("docker-compose.yml", ".env"):
                raise Error("Required audio setup configuration backup is missing.")
        if not isinstance(state["outputs"], dict) or set(state["outputs"]) != {"website-state", "catalog"} or any(value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)) for value in state["outputs"].values()):
            raise Error("Audio setup output fingerprints are invalid.")
        if not isinstance(state["baselines"], dict) or set(state["baselines"]) != set(state["images"]):
            raise Error("Audio setup container baselines are invalid.")
        for name, record in state["baselines"].items():
            if record is None:
                if name != AUDIO or name in state["previous"]:
                    raise Error("Audio setup is missing a required original container.")
            elif (not isinstance(record, dict) or set(record) != {"id", "image", "restarts", "started"} or
                  not isinstance(record["id"], str) or not re.fullmatch(r"[0-9a-f]{12,64}", record["id"]) or
                  record["image"] != state["previous"].get(name) or type(record["restarts"]) is not int or
                  record["restarts"] < 0 or not isinstance(record["started"], str)):
                raise Error("Audio setup original container identity is invalid.")
        return state

    def rollback(self, state):
        if not state["pending"]:
            raise Error("This transaction is no longer pending; review a fresh plan.")
        backup = Path(state["backup"])
        transaction = backup.name.removeprefix(".bouncer-audio-backup-")
        # Validate every target before touching even one configuration file.
        for name in ("docker-compose.yml", ".env"):
            current = safe_path(self.directory / name, exists=True)
            record = state["files"][name]
            if digest(current.read_bytes()) not in (record["before"], record["after"]):
                raise Error("Configuration has concurrent operator edits; recovery refuses to overwrite them. Pending journal retained.")
        for name, path in (("website-state", self.state_path), ("catalog", self.hls / "catalog.json")):
            current = digest(safe_path(path, exists=True).read_bytes()) if path.exists() else None
            before = state["files"][name]["before"] if state["files"][name] else None
            if current not in (before, state["outputs"][name]):
                raise Error("Website state or catalog changed outside a journaled step; refusing to overwrite it. Pending journal retained for local inspection.")
        if json.loads(self.compose("config", "--format", "json"))["name"] != state["project"]:
            raise Error("Compose project identity changed; refusing automatic recovery.")
        for name, baseline in state["baselines"].items():
            identifiers = self.docker("ps", "-aq", "--filter", f"label=com.docker.compose.project={state['project']}",
                                      "--filter", f"label=com.docker.compose.service={name}").split()
            if len(identifiers) > 1 or (not identifiers and baseline and state["phase"] != "activating"):
                raise Error("Original containers changed outside setup; refusing recovery.")
            if not identifiers:
                continue
            container = json.loads(self.docker("inspect", identifiers[0]))[0]
            labels = container.get("Config", {}).get("Labels", {})
            original = baseline and identifiers[0] == baseline["id"] and container.get("Image") == baseline["image"] and container.get("RestartCount", 0) == baseline["restarts"] and container.get("State", {}).get("StartedAt") == baseline["started"]
            owned = (state["phase"] == "activating" and labels.get(TRANSACTION_LABEL) == transaction and
                     container.get("Image") in (state["images"][name], state["previous"].get(name)))
            if (not original and not owned) or labels.get("com.docker.compose.project") != state["project"] or labels.get("com.docker.compose.service") != name:
                raise Error("A selected container changed outside this transaction; pending recovery refuses to replace it.")
        if (self.hls / ".packaging.lock").exists():
            raise Error("Packaging lock remains; confirm no packaging process is active and inspect it locally before recovery. Pending journal retained.")
        if state["phase"] == "activating" and AUDIO not in state["previous"]:
            identifiers = self.docker("ps", "-aq", "--filter", f"label=com.docker.compose.project={state['project']}",
                                      "--filter", f"label=com.docker.compose.service={AUDIO}").split()
            if len(identifiers) > 1:
                raise Error("Multiple audio containers appeared; refusing automatic removal.")
            if identifiers:
                container = json.loads(self.docker("inspect", identifiers[0]))[0]
                labels = container.get("Config", {}).get("Labels", {})
                if container.get("Image") != state["images"][AUDIO] or labels.get("com.docker.compose.project") != state["project"] or labels.get("com.docker.compose.service") != AUDIO or labels.get(TRANSACTION_LABEL) != transaction:
                    raise Error("Audio container changed outside setup; refusing to remove it.")
                self.docker("stop", "--time", "15", identifiers[0])
                self.docker("rm", identifiers[0])
        for name in ("docker-compose.yml", ".env"):
            atomic_write(self.directory / name, (backup / name).read_bytes(), state["files"][name])
        if state["phase"] == "activating":
            self.activate(state["previous"], labels={TRANSACTION_LABEL: transaction})
        for name, path in (("website-state", self.state_path), ("catalog", self.hls / "catalog.json")):
            record = state["files"][name]
            if record:
                atomic_write(path, (backup / name).read_bytes(), record)
            elif path.exists():
                # No pre-existing catalog/state: preserve generated media, but not a newly published catalog.
                safe_path(path, exists=True).unlink()
                sync_directory(path.parent)
        # Private new key and generated cache are retained for safe retry; no source bytes are touched.
        # Keep safe provisioned permissions rather than weakening them during rollback.
        state["pending"] = False
        state["phase"] = "rolled-back"
        self.write_journal(state)
        print("Previous configuration and selected images restored. Private key/cache and private backups retained; originals untouched.")

    def apply(self, plan):
        images, packager_image = self.prepare_images(plan)
        self.check_baselines(plan)
        if self.reviewed_checkout() != plan["revision"]:
            raise Error("The reviewed checkout changed during image preparation; no configuration changed.")
        # An already configured, healthy release is a read-only no-op, not a key rotation.
        if (plan["compose_before"] == plan["compose_after"] and plan["env_before"] == plan["env_after"] and
                not plan["permissions"] and plan["key_exists"] and images == plan["previous"]):
            print("Audio setup is already complete for this release; nothing recreated or rotated.")
            return
        state = self.snapshot(plan, images)
        try:
            self.provision(plan)
            atomic_write(self.directory / "docker-compose.yml", plan["compose_after"].encode(), state["files"]["docker-compose.yml"])
            atomic_write(self.directory / ".env", plan["env_after"].encode(), state["files"][".env"])
            state["phase"] = "configured"
            self.write_journal(state)
            config = json.loads(self.compose("config", "--format", "json"))
            if config != plan["config"]:
                raise Error("Installed candidate differs from the reviewed plan; stopping.")
            self.validate_audio(config)
            if self.reviewed_checkout() != plan["revision"]:
                raise Error("The reviewed checkout changed before packaging; review a fresh plan.")
            state["phase"] = "packaging"
            self.write_journal(state)
            # The reviewed source is baked into this prepared image. No host
            # checkout script, Node binary or FFmpeg executable is run.
            self.package_audio(packager_image)
            catalog = safe_path(self.hls / "catalog.json", exists=True)
            state["outputs"]["catalog"] = digest(catalog.read_bytes())
            self.write_journal(state)
            # Capture using the old semantic config while the installed file now includes audio.
            if self.capture(plan["old_config"], plan["expected"]) != plan["baselines"]:
                raise Error("A container changed during packaging; refusing activation.")
            for name, expected in (("docker-compose.yml", plan["compose_after"]), (".env", plan["env_after"])):
                if safe_path(self.directory / name, exists=True).read_bytes().decode() != expected:
                    raise Error("Configuration changed during packaging; refusing activation.")
            state["phase"] = "activating"
            self.write_journal(state)
            self.activate(images, labels={TRANSACTION_LABEL: Path(state["backup"]).name.removeprefix(".bouncer-audio-backup-")})
            website_state = {"previous": plan["previous"], "current": images, "revision": plan["revision"]}
            state["outputs"]["website-state"] = digest((json.dumps(website_state, sort_keys=True) + "\n").encode())
            self.write_journal(state)
            self.save(website_state)
            state["pending"] = False
            state["phase"] = "complete"
            self.write_journal(state)
        except BaseException:
            try:
                self.rollback(state)
            except BaseException:
                raise Error("Setup failed and recovery remains pending. Run --recover to inspect, then --recover --apply after resolving the blocker. Do not delete the journal or packaging lock.") from None
            raise Error("Setup failed; the previous configuration/images were restored. Review locally before retrying.") from None
        print("Audio is enabled and selected services passed health checks. Shared services and scheduler were not reconciled.")
        print("Verify /game/ playback and existing checkout over HTTPS. Keep private backups until verified.")


def confirm(token, *, permissions=False):
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise Error("Apply/recovery requires an interactive terminal and explicit confirmation; there is no --yes mode.")
    if permissions:
        print("This removes group-write ONLY from the exact displayed tracked checkout directories, preserving owner/group and all other mode bits. It does not enable audio or change file permissions.")
    else:
        print("This changes private key/access settings, installed configuration and selected running containers; website/audio may briefly restart.")
    print("Only continue after reviewing this checkout and the displayed plan.")
    print("Only the normal reviewed deploy/bouncer/update.py schedule is coordinated automatically.")
    print("Pause any older copied updater, custom cron/systemd deployment or plain Docker operation separately before continuing.")
    if input(f"Type {token} to continue: ").strip() != token:
        raise Error("Confirmation not given; no changes made.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default=str(Path.home() / "bouncer"), metavar="DEPLOYMENT_ROOT",
                        help="existing deployment root containing docker-compose.yml and .env (default: ~/bouncer); music remains under DEPLOYMENT_ROOT/gyaruinthemix/assets/music")
    parser.add_argument("--key-file", help="absolute key path in a dedicated directory outside the checkout; never the key itself")
    parser.add_argument("--apply", action="store_true", help="interactively approve and apply the plan")
    parser.add_argument("--dry-run", action="store_true", help="explicit read-only plan (the default)")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--recover", action="store_true", help="plan recovery of this setup's interrupted transaction")
    modes.add_argument("--prepare-permissions", action="store_true", help="plan narrowly scoped tracked-directory group-write removal; use --apply for interactive confirmation")
    args = parser.parse_args(argv)
    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run are mutually exclusive")
    if args.prepare_permissions and args.key_file:
        parser.error("--key-file does not apply to tracked-directory permission preparation")
    os.umask(0o077)
    try:
        setup = AudioSetup(args.directory, args.key_file)
        if args.prepare_permissions:
            plan = setup.permission_plan()
            setup.show_permission_plan(plan)
            if not plan["changes"]:
                return 0
            token = "PREPARE PERMISSIONS " + plan["revision"][:12]
        elif args.recover:
            state = setup.read_journal()
            if not state["pending"]:
                print("No audio setup recovery is pending.")
                return 0
            print("Recovery plan: restore this transaction's private configuration backups and prior selected image IDs.")
            print(f"Project: {state['project']}; candidate revision: {state['revision']}; backups: {state['backup']}")
            print("Selected prior services: " + ", ".join(sorted(state["previous"])))
            print("Never overwrite concurrent edits, remove pre-existing audio, delete a key, or remove a packaging lock.")
            token = "RECOVER AUDIO"
        else:
            plan = setup.plan()
            setup.show_plan(plan)
            token = "ENABLE AUDIO " + plan["revision"][:12]
        if not args.apply:
            return 0
        if args.prepare_permissions:
            confirm(token, permissions=True)
        else:
            confirm(token)
        lock_path = safe_path(setup.directory / LOCK)
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode) or os.fstat(lock.fileno()).st_nlink != 1:
                raise Error("Updater lock is not a singly linked regular file.")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Error("Another bouncer update is running; rerun after it finishes. No setup changes made.") from None
            update.guard_pending(setup.directory, "game-audio-setup")
            if args.prepare_permissions:
                current = setup.permission_plan()
                if current != plan:
                    raise Error("The permission plan changed while awaiting confirmation; review and confirm a fresh plan.")
                setup.apply_permissions(current)
            elif args.recover:
                setup.local_docker()
                current = setup.read_journal()
                if not current["pending"] or current != state:
                    raise Error("Recovery state changed while awaiting confirmation; review and confirm a fresh recovery plan.")
                setup.rollback(current)
            else:
                current = setup.plan()
                if current != plan:
                    raise Error("The plan changed before lock acquisition; review a fresh plan and confirm again.")
                setup.apply(current)
    except (Error, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"Audio setup stopped: {error if isinstance(error, Error) else type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
