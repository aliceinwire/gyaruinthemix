import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  components,
  publishedManifest,
  shaPattern,
} from './release-manifest.mjs';

export const allScopes = [
  'site',
  'game',
  'api',
  'audio',
  'packager',
  'deployment',
];
const web = ['web', 'web-api'];
const affected = (build, scopes) => ({ build, scopes });

export function testScopes(path) {
  if (
    /\/test_bouncer|\/ci-|\/release-manifest|\/publish-release|\/build-cache|\/build-components/.test(
      path,
    )
  )
    return ['deployment'];
  if (/\/game-/.test(path)) return ['game'];
  if (/\/audio-/.test(path)) return ['audio', 'packager'];
  if (
    /\/(api|commerce-integration|config|inventory|journal|member-access|membership|setup-secret)\./.test(
      path,
    )
  )
    return ['api', 'site'];
  if (/\/(release-version|domain|crawler-policy)\./.test(path))
    return ['site', 'game'];
  return ['site'];
}

export function classify(path) {
  if (
    /\.md$/.test(path) &&
    !path.startsWith('src/') &&
    !path.startsWith('public/')
  )
    return affected([], []);
  if (path.startsWith('tests/')) {
    if (
      path.startsWith('tests/fixtures/') ||
      path === 'tests/browser/package.json'
    )
      return affected([], allScopes);
    if (path.startsWith('tests/browser/'))
      return affected([], [path.endsWith('/check.mjs') ? 'site' : 'game']);
    return affected([], testScopes(path));
  }
  if (path.startsWith('public/game/'))
    return affected(web, [
      'game',
      ...(/audio|radio|music|hls/.test(path) ? ['audio'] : []),
    ]);
  if (
    path === 'scripts/optimize-game-images.mjs' ||
    path === 'scripts/build-game.mjs'
  )
    return affected(web, ['game']);
  if (path === 'src/data/release.mjs' || path === 'scripts/release-version.mjs')
    return affected(web, ['site', 'game']);
  if (path.startsWith('src/'))
    return affected(web, [
      'site',
      ...(/streaming-guidelines|\/urls.mjs$/.test(path) ? ['game'] : []),
    ]);
  if (
    path.startsWith('assets/originals/') ||
    path === 'scripts/images.mjs' ||
    path === 'scripts/build-podcast-index.mjs' ||
    path === 'scripts/podcast-index.mjs' ||
    path === 'deploy/podcast-web.sh' ||
    path === 'scripts/build-site.mjs'
  )
    return affected(web, ['site']);
  if (path.startsWith('config/'))
    return affected([...web, 'api'], ['site', 'api']);
  if (
    path.startsWith('api/') ||
    path === 'Dockerfile.api' ||
    path === 'deploy/api-healthcheck.mjs'
  )
    return affected(['api'], ['api', 'site']);
  if (
    path.startsWith('game-audio/server/') ||
    path === 'game-audio/deploy/healthcheck.mjs'
  )
    return affected(['game-audio'], ['audio', 'game']);
  if (path === 'game-audio/scripts/package-library.mjs')
    return affected(['game-audio-packager'], ['packager', 'audio', 'game']);
  if (path === 'Dockerfile.game-audio')
    return affected(
      ['game-audio', 'game-audio-packager'],
      ['audio', 'packager', 'game'],
    );
  if (
    path === 'Dockerfile.web' ||
    path.startsWith('deploy/nginx') ||
    path.endsWith('headers.conf') ||
    path.startsWith('deploy/game-audio')
  )
    return affected(web, allScopes);
  return affected(components, allScopes);
}

export function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}

export function changedFiles(base, revision) {
  if (!shaPattern.test(base || '') || !shaPattern.test(revision))
    throw new Error('Invalid comparison revision');
  return git('diff', '--no-renames', '--name-only', '-z', base, revision)
    .split('\0')
    .filter(Boolean);
}

export function componentInputs(revision) {
  const hashes = Object.fromEntries(
    components.map((name) => [name, createHash('sha256')]),
  );
  for (const entry of git('ls-tree', '-r', '-z', revision)
    .split('\0')
    .filter(Boolean)) {
    const path = entry.slice(entry.indexOf('\t') + 1);
    for (const name of classify(path).build) hashes[name].update(entry + '\0');
  }
  return Object.fromEntries(
    components.map((name) => [name, hashes[name].digest('hex')]),
  );
}

export function makePlan({
  paths,
  revision,
  inputs,
  previous = null,
  componentReleases = false,
  full = false,
}) {
  const scopes = new Set(full ? allScopes : []);
  const changed = new Set(full ? components : []);
  for (const path of paths) {
    const impact = classify(path);
    for (const name of impact.build) changed.add(name);
    for (const scope of impact.scopes) scopes.add(scope);
  }
  // Content fingerprints independently catch changes accumulated since publication.
  if (previous)
    for (const name of components)
      if (
        previous.components[name].input !== inputs[name] &&
        !changed.has(name)
      ) {
        changed.add(name);
        for (const scope of allScopes) scopes.add(scope);
      }
  const deploy = changed.size > 0;
  const build = Object.fromEntries(
    components.map((name) => [
      name,
      deploy && (!componentReleases || !previous || changed.has(name)),
    ]),
  );
  const browser = [];
  if (scopes.has('site') || scopes.has('api') || scopes.has('deployment'))
    for (const mode of ['payment_links', 'api'])
      browser.push({ suite: 'site', mode });
  if (
    ['game', 'audio', 'packager', 'deployment'].some((scope) =>
      scopes.has(scope),
    )
  )
    browser.push({ suite: 'game', mode: 'payment_links' });
  const containers = [];
  if (scopes.size) {
    containers.push({ mode: 'payment_links', audio: 'false' });
    if (scopes.has('api') || scopes.has('deployment'))
      containers.push({ mode: 'api', audio: 'false' });
    if (['audio', 'packager', 'deployment'].some((scope) => scopes.has(scope)))
      for (const mode of ['payment_links', 'api'])
        containers.push({ mode, audio: 'true' });
  }
  return {
    revision,
    previous,
    inputs,
    build,
    deploy,
    componentReleases,
    scopes: [...scopes].sort(),
    browser: { include: browser },
    containers: { include: containers },
  };
}

async function main() {
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const revision = process.env.GITHUB_SHA;
  if (!shaPattern.test(revision)) throw new Error('Invalid CI revision');
  let previous = null,
    base = null,
    full = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    base = git(
      'merge-base',
      event.pull_request.base.sha,
      event.pull_request.head.sha,
    );
  } else {
    previous = publishedManifest();
    if (previous) {
      try {
        git('merge-base', '--is-ancestor', previous.revision, revision);
        base = previous.revision;
      } catch {
        previous = null;
      }
    }
    if (!base) full = true;
  }
  const paths = base ? changedFiles(base, revision) : [];
  const plan = makePlan({
    paths,
    revision,
    previous,
    inputs: componentInputs(revision),
    full,
    componentReleases: process.env.COMPONENT_RELEASES_ENABLED === 'true',
  });
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/release-plan.json',
    JSON.stringify(plan, null, 2) + '\n',
  );
  for (const [key, value] of Object.entries({
    deploy: plan.deploy,
    scopes: plan.scopes,
    browser: plan.browser,
    containers: plan.containers,
    static: {
      include: [
        ...new Set(plan.browser.include.map((entry) => entry.mode)),
      ].map((mode) => ({ mode })),
    },
    has_browser: plan.browser.include.length > 0,
    has_containers: plan.containers.include.length > 0,
  }))
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `${key}=${JSON.stringify(value)}\n`,
    );
  console.log(
    JSON.stringify({
      deploy: plan.deploy,
      build: plan.build,
      scopes: plan.scopes,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
