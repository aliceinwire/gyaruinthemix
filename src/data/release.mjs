import manifest from '../../package.json' with { type: 'json' };

// SemVer 2.0.0 identifiers: prerelease numbers have no leading zeroes.
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isSemanticVersion(value) {
  return typeof value === 'string' && semver.test(value) && !/\s/.test(value);
}

if (!isSemanticVersion(manifest.version)) {
  throw new Error(
    'package.json must contain a Semantic Versioning 2.0.0 version.',
  );
}

export const releaseVersion = manifest.version;
