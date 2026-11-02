import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { allScopes, testScopes } from './ci-plan.mjs';

const scopes = JSON.parse(process.env.CI_SCOPES || JSON.stringify(allScopes));
const files = (await readdir('tests'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `tests/${name}`)
  .filter(
    (path) =>
      testScopes(path).some((scope) => scopes.includes(scope)) ||
      /ci-plan|release-manifest|publish-release|build-cache|build-components/.test(
        path,
      ),
  );
if (files.length)
  execFileSync(process.execPath, ['--test', ...files.sort()], {
    stdio: 'inherit',
  });
if (scopes.some((scope) => ['deployment', 'audio', 'packager'].includes(scope)))
  execFileSync(
    'python3',
    ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_bouncer*.py'],
    { stdio: 'inherit' },
  );
