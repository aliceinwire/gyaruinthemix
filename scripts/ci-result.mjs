import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function checkResults(needs, event, ref, repository) {
  for (const name of ['changes', 'source', 'secrets'])
    assert.equal(needs[name]?.result, 'success', name);
  const outputs = needs.changes.outputs;
  const required = {
    static: outputs.has_browser === 'true',
    browser: outputs.has_browser === 'true',
    containers: outputs.has_containers === 'true',
    prepare:
      outputs.deploy === 'true' &&
      (event === 'pull_request' ||
        (event === 'push' && ref === 'refs/heads/main')) &&
      repository === 'aliceinwire/gyaruinthemix',
  };
  for (const [name, selected] of Object.entries(required))
    assert.equal(needs[name]?.result, selected ? 'success' : 'skipped', name);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkResults(
    JSON.parse(process.env.CI_RESULTS),
    process.env.GITHUB_EVENT_NAME,
    process.env.GITHUB_REF,
    process.env.GITHUB_REPOSITORY,
  );
  console.log('Every required check succeeded.');
}
