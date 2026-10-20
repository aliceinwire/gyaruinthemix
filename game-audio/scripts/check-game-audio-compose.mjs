import assert from 'node:assert/strict';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const GAME_AUDIO_SERVICE = 'gyaruinthemix-game-audio';
export const GAME_AUDIO_SECRET = 'gyaruinthemix_game_audio_signing_key';
export const ORIGINAL_SERVICES = Object.freeze([
  'proxy',
  'letsencrypt-companion',
  'znc',
  'limnoria',
]);

function contained(path, directory) {
  const part = relative(directory, path);
  return (
    part === '' ||
    (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
}

function privatePath(path, checkoutRoot, label, approvedCheckoutPath) {
  assert.equal(
    typeof path,
    'string',
    `${label} must be an explicit absolute path`,
  );
  assert.ok(isAbsolute(path), `${label} must be absolute`);
  assert.equal(
    resolve(path),
    path,
    `${label} must be normalized without dot segments`,
  );
  assert.notEqual(path, '/', `${label} must not expose the host root`);
  assert.ok(!/[\x00-\x1f\x7f]/.test(path), `${label} has control characters`);
  assert.ok(
    path === approvedCheckoutPath || !contained(path, checkoutRoot),
    `${label} must stay outside the checkout except for the exact approved assets/music directory`,
  );
  assert.ok(
    !contained(checkoutRoot, path),
    `${label} must not contain the checkout`,
  );
}

/** Validate a config-only probe produced by the same Compose JSON serializer.
 * compose-go 2.7.1 omits false booleans; newer versions preserve false and may
 * omit true instead. Never infer either meaning from an unproven empty object.
 */
export function gameAudioFalseBindOptions({ disabled, enabled }) {
  for (const [value, expected] of [
    [disabled, false],
    [enabled, true],
  ]) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    assert.deepEqual(
      value,
      Object.hasOwn(value, 'create_host_path')
        ? { create_host_path: expected }
        : {},
      'Unexpected Compose bind serialization',
    );
  }
  assert.notDeepEqual(
    disabled,
    enabled,
    'Compose must distinguish disabled host-path creation from enabled',
  );
  return structuredClone(disabled);
}

/**
 * Pure validation of Docker Compose's normalized JSON. No daemon, filesystem,
 * credentials or external mutations. Expected paths are trusted CI/operator
 * inputs, NOT copied out of the untrusted candidate configuration.
 *
 * This supplements ci-bouncer.mjs, never replaces its original-service checks
 * or its unconditional web/API no-bind/no-port/isolation checks.
 */
export function assertGameAudioCompose({
  original,
  config,
  audioEnabled,
  apiMode = false,
  checkoutRoot,
  expectedMediaSource,
  expectedSecretFile,
  expectedPort = '3001',
  expectedUser = '10001:10001',
  expectedDockerfile = 'Dockerfile.game-audio',
  expectedImage = 'gyaruinthemix-game-audio:ci',
  expectedHealthcheck = ['CMD', 'node', '/app/healthcheck.mjs'],
  // Trusted false representation returned by gameAudioFalseBindOptions, never
  // copied from the candidate service. Default remains explicitly false.
  expectedMediaBindOptions = { create_host_path: false },
}) {
  assert.equal(typeof audioEnabled, 'boolean');
  assert.equal(typeof apiMode, 'boolean');
  assert.ok(isAbsolute(checkoutRoot));
  assert.equal(resolve(checkoutRoot), checkoutRoot);
  const appServices = apiMode
    ? ['gyaruinthemix-web', 'gyaruinthemix-api']
    : ['gyaruinthemix-web'];
  assert.deepEqual(
    Object.keys(config.services).sort(),
    [
      ...ORIGINAL_SERVICES,
      ...appServices,
      ...(audioEnabled ? [GAME_AUDIO_SERVICE] : []),
    ].sort(),
    'Only the explicitly enabled audio service may be added',
  );
  for (const name of ORIGINAL_SERVICES) {
    assert.deepEqual(
      config.services[name],
      original.services[name],
      `${name} must remain unchanged`,
    );
  }
  for (const name of Object.keys(original.volumes ?? {})) {
    assert.deepEqual(
      config.volumes?.[name],
      original.volumes[name],
      `${name} volume changed`,
    );
  }
  for (const name of Object.keys(original.networks ?? {})) {
    assert.deepEqual(
      config.networks?.[name],
      original.networks[name],
      `${name} network changed`,
    );
  }
  assert.equal(
    config.name,
    original.name,
    'Existing Compose project must remain unchanged',
  );

  // These guards deliberately stay separate from the audio exception.
  for (const name of appServices) {
    const service = config.services[name];
    assert.ok(
      !service.volumes?.some((volume) => volume.type === 'bind'),
      `${name} bind mounts remain forbidden`,
    );
    assert.equal(
      service.ports?.length ?? 0,
      0,
      `${name} host ports remain forbidden`,
    );
    assert.ok(
      !service.secrets?.some((secret) => secret.source === GAME_AUDIO_SECRET),
      `${name} cannot read the audio secret`,
    );
  }
  for (const [name, service] of Object.entries(config.services)) {
    if (name === GAME_AUDIO_SERVICE) continue;
    assert.ok(
      !service.secrets?.some((secret) => secret.source === GAME_AUDIO_SECRET),
      `${name} cannot read the audio secret`,
    );
  }
  if (!audioEnabled) {
    assert.equal(
      config.services[GAME_AUDIO_SERVICE],
      undefined,
      'Audio must be absent by default',
    );
    return;
  }

  privatePath(
    expectedMediaSource,
    checkoutRoot,
    'media source',
    join(checkoutRoot, 'assets/music'),
  );
  assert.equal(
    expectedMediaSource.split(sep).slice(-2).join('/'),
    'assets/music',
    'Only an assets/music library is permitted',
  );
  privatePath(expectedSecretFile, checkoutRoot, 'secret file');
  assert.ok(
    !contained(expectedSecretFile, expectedMediaSource),
    'Signing secret must not sit in the media tree',
  );
  assert.ok(
    !contained(expectedMediaSource, expectedSecretFile),
    'Media and secret paths overlap',
  );
  assert.match(expectedPort, /^\d{1,5}$/);
  assert.ok(Number(expectedPort) > 1023 && Number(expectedPort) < 65536);
  assert.match(expectedUser, /^[1-9]\d*:[1-9]\d*$/);

  const audio = config.services[GAME_AUDIO_SERVICE];
  const allowedKeys = new Set([
    'profiles',
    'image',
    'build',
    'restart',
    'init',
    'read_only',
    'user',
    'cap_drop',
    'security_opt',
    'tmpfs',
    'mem_limit',
    'cpus',
    'pids_limit',
    'stop_grace_period',
    'expose',
    'networks',
    'volumes',
    'secrets',
    'environment',
    'logging',
    'healthcheck',
  ]);
  for (const key of Object.keys(audio)) {
    // compose-go intentionally serializes unset image defaults as null. Empty
    // arrays/strings are NOT equivalent: they clear the image's command.
    if (key === 'command' || key === 'entrypoint') {
      assert.equal(audio[key], null, `Audio ${key} override is forbidden`);
      continue;
    }
    assert.ok(allowedKeys.has(key), `Unreviewed audio service option: ${key}`);
  }
  assert.deepEqual(audio.profiles, ['game-audio']);
  assert.equal(audio.read_only, true);
  assert.equal(audio.init, true);
  assert.equal(audio.user, expectedUser);
  assert.deepEqual(audio.cap_drop, ['ALL']);
  assert.deepEqual(audio.security_opt, ['no-new-privileges:true']);
  assert.deepEqual(audio.expose, [expectedPort]);
  assert.ok(['unless-stopped', 'no'].includes(audio.restart));
  assert.ok(
    Number.isFinite(Number(audio.mem_limit)) &&
      Number(audio.mem_limit) >= 32 * 1024 * 1024 &&
      Number(audio.mem_limit) <= 192 * 1024 * 1024,
    'Audio requires a 32–192 MiB memory ceiling',
  );
  assert.ok(
    Number(audio.cpus) > 0 && Number(audio.cpus) <= 0.75,
    'Audio requires a CPU ceiling of at most 0.75',
  );
  assert.ok(
    Number.isInteger(audio.pids_limit) &&
      audio.pids_limit > 0 &&
      audio.pids_limit <= 64,
    'Audio requires a PID ceiling of at most 64',
  );
  assert.deepEqual(audio.networks, {
    gyaruinthemix: { aliases: ['game-audio'] },
  });
  assert.ok(
    expectedMediaBindOptions &&
      typeof expectedMediaBindOptions === 'object' &&
      !Array.isArray(expectedMediaBindOptions),
  );
  assert.deepEqual(
    expectedMediaBindOptions,
    Object.hasOwn(expectedMediaBindOptions, 'create_host_path')
      ? { create_host_path: false }
      : {},
  );
  assert.deepEqual(
    audio.volumes,
    [
      {
        type: 'bind',
        source: expectedMediaSource,
        target: '/private/media',
        read_only: true,
        bind: expectedMediaBindOptions,
      },
    ],
    'Only the exact read-only media bind is permitted',
  );
  assert.deepEqual(audio.secrets, [
    { source: GAME_AUDIO_SECRET, target: 'game_audio_signing_key' },
  ]);
  const secret = config.secrets?.[GAME_AUDIO_SECRET];
  assert.ok(secret, 'Audio signing secret definition missing');
  // Compose may expand the project-scoped name. Never permit environment or
  // external secret substitutions, or silently accept a second file.
  assert.ok(Object.keys(secret).every((key) => ['file', 'name'].includes(key)));
  assert.equal(secret.file, expectedSecretFile);
  assert.equal(audio.environment?.AUDIO_MEDIA_ROOT, '/private/media/.hls');
  assert.equal(
    audio.environment?.AUDIO_SIGNING_KEY_FILE,
    '/run/secrets/game_audio_signing_key',
  );
  assert.equal(audio.environment?.NODE_ENV, 'production');
  assert.equal(audio.environment?.GAME_AUDIO_ENABLED, 'true');
  if (audio.environment.PORT !== undefined)
    assert.equal(audio.environment.PORT, expectedPort);
  if (audio.environment.AUDIO_PORT !== undefined)
    assert.equal(audio.environment.AUDIO_PORT, expectedPort);
  for (const key of Object.keys(audio.environment)) {
    assert.ok(
      key === 'NODE_ENV' ||
        key === 'PORT' ||
        key === 'GAME_AUDIO_ENABLED' ||
        key.startsWith('AUDIO_'),
      `Unreviewed audio environment option: ${key}`,
    );
  }
  for (const key of Object.keys(audio.build ?? {})) {
    assert.ok(
      ['context', 'dockerfile', 'labels'].includes(key),
      `Unreviewed audio build option: ${key}`,
    );
  }
  if (audio.build) {
    assert.equal(audio.build.context, checkoutRoot);
    assert.equal(audio.build.dockerfile, expectedDockerfile);
  }
  assert.ok(
    typeof expectedImage === 'string' && expectedImage.length > 0,
    'Explicit reviewed image required',
  );
  assert.equal(audio.image, expectedImage);
  assert.deepEqual(audio.logging, {
    driver: 'json-file',
    options: { 'max-size': '5m', 'max-file': '3' },
  });
  if (audio.tmpfs) {
    assert.deepEqual(audio.tmpfs, [
      '/tmp:size=8m,mode=1777,noexec,nosuid,nodev',
    ]);
  }
  assert.equal(audio.healthcheck?.disable, undefined);
  assert.deepEqual(
    audio.healthcheck?.test,
    expectedHealthcheck,
    'Audio requires the exact reviewed healthcheck',
  );
}
