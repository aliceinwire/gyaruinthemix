import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertGameAudioCompose,
  gameAudioFalseBindOptions,
  GAME_AUDIO_SERVICE as AUDIO,
  GAME_AUDIO_SECRET as SECRET,
  ORIGINAL_SERVICES,
} from '../scripts/check-game-audio-compose.mjs';

const checkoutRoot = '/ci/bouncer/gyaruinthemix';
const expectedMediaSource = '/srv/gyaruinthemix-media/assets/music';
const expectedSecretFile = '/srv/gyaruinthemix-secrets/game_audio_signing_key';

function fixture({ audioEnabled = true, apiMode = false } = {}) {
  const original = {
    name: 'existing-bouncer',
    services: Object.fromEntries(
      ORIGINAL_SERVICES.map((name) => [
        name,
        {
          image: `original-${name}`,
          volumes: [
            { type: 'bind', source: `/original/${name}`, target: '/original' },
          ],
        },
      ]),
    ),
    volumes: { certs: {}, 'vhost.d': {}, html: {} },
    networks: { 'proxy-tier': { name: 'nginx-proxy' } },
  };
  const config = structuredClone(original);
  config.services['gyaruinthemix-web'] = {};
  if (apiMode)
    config.services['gyaruinthemix-api'] = {
      volumes: [
        {
          type: 'volume',
          source: 'gyaruinthemix_webhook_state',
          target: '/app/state',
        },
      ],
    };
  config.secrets = {
    [SECRET]: { file: expectedSecretFile, name: `existing-bouncer_${SECRET}` },
  };
  if (audioEnabled)
    config.services[AUDIO] = {
      profiles: ['game-audio'],
      image: 'gyaruinthemix-game-audio:ci',
      build: { context: checkoutRoot, dockerfile: 'Dockerfile.game-audio' },
      restart: 'unless-stopped',
      init: true,
      read_only: true,
      user: '10001:10001',
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      tmpfs: ['/tmp:size=8m,mode=1777,noexec,nosuid,nodev'],
      mem_limit: 100663296,
      cpus: 0.5,
      pids_limit: 50,
      expose: ['3001'],
      networks: { gyaruinthemix: { aliases: ['game-audio'] } },
      volumes: [
        {
          type: 'bind',
          source: expectedMediaSource,
          target: '/private/media',
          read_only: true,
          bind: { create_host_path: false },
        },
      ],
      secrets: [{ source: SECRET, target: 'game_audio_signing_key' }],
      environment: {
        NODE_ENV: 'production',
        GAME_AUDIO_ENABLED: 'true',
        AUDIO_MEDIA_ROOT: '/private/media/.hls',
        AUDIO_SIGNING_KEY_FILE: '/run/secrets/game_audio_signing_key',
      },
      logging: {
        driver: 'json-file',
        options: { 'max-size': '5m', 'max-file': '3' },
      },
      healthcheck: { test: ['CMD', 'node', '/app/healthcheck.mjs'] },
    };
  return {
    original,
    config,
    audioEnabled,
    apiMode,
    checkoutRoot,
    expectedMediaSource,
    expectedSecretFile,
  };
}

for (const apiMode of [false, true])
  for (const audioEnabled of [false, true]) {
    test(`accepts reviewed matrix api=${apiMode} audio=${audioEnabled}`, () => {
      assert.doesNotThrow(() =>
        assertGameAudioCompose(fixture({ apiMode, audioEnabled })),
      );
    });
  }

const mutations = {
  'adds an unrelated service': (f) => {
    f.config.services.unrelated = {};
  },
  'changes an old service': (f) => {
    f.config.services.znc.image = 'changed';
  },
  'changes an old network': (f) => {
    f.config.networks['proxy-tier'].name = 'replacement';
  },
  'changes an old volume': (f) => {
    f.config.volumes.certs = { external: true };
  },
  'renames project': (f) => {
    f.config.name = 'replacement';
  },
  'binds into web': (f) => {
    f.config.services['gyaruinthemix-web'].volumes = [
      { type: 'bind', source: '/etc', target: '/etc' },
    ];
  },
  'gives web the audio secret': (f) => {
    f.config.services['gyaruinthemix-web'].secrets = [{ source: SECRET }];
  },
  'gives old service the audio secret': (f) => {
    f.config.services.znc.secrets = [{ source: SECRET }];
  },
  'publishes web port': (f) => {
    f.config.services['gyaruinthemix-web'].ports = [{ published: '8080' }];
  },
  'publishes audio port': (f) => {
    f.config.services[AUDIO].ports = [{ published: '3001' }];
  },
  'enables privileged': (f) => {
    f.config.services[AUDIO].privileged = true;
  },
  'adds capabilities': (f) => {
    f.config.services[AUDIO].cap_add = ['SYS_ADMIN'];
  },
  'shares host network': (f) => {
    f.config.services[AUDIO].network_mode = 'host';
  },
  'shares host pid': (f) => {
    f.config.services[AUDIO].pid = 'host';
  },
  'shares host ipc': (f) => {
    f.config.services[AUDIO].ipc = 'host';
  },
  'mounts another service volumes': (f) => {
    f.config.services[AUDIO].volumes_from = ['proxy'];
  },
  'attaches device': (f) => {
    f.config.services[AUDIO].devices = ['/dev/sda'];
  },
  'uses config mount': (f) => {
    f.config.services[AUDIO].configs = ['extra'];
  },
  'changes command': (f) => {
    f.config.services[AUDIO].command = ['sh'];
  },
  'clears command with empty list': (f) => {
    f.config.services[AUDIO].command = [];
  },
  'clears command with empty string': (f) => {
    f.config.services[AUDIO].command = '';
  },
  'clears entrypoint with empty list': (f) => {
    f.config.services[AUDIO].entrypoint = [];
  },
  'clears entrypoint with empty string': (f) => {
    f.config.services[AUDIO].entrypoint = '';
  },
  'adds unreviewed null setting': (f) => {
    f.config.services[AUDIO].privileged = null;
  },
  'changes entrypoint': (f) => {
    f.config.services[AUDIO].entrypoint = ['sh'];
  },
  'joins public proxy network': (f) => {
    f.config.services[AUDIO].networks['proxy-tier'] = {};
  },
  'starts without profile': (f) => {
    delete f.config.services[AUDIO].profiles;
  },
  'runs as root': (f) => {
    f.config.services[AUDIO].user = '0:0';
  },
  'removes read-only root': (f) => {
    f.config.services[AUDIO].read_only = false;
  },
  'removes memory ceiling': (f) => {
    delete f.config.services[AUDIO].mem_limit;
  },
  'expands CPU': (f) => {
    f.config.services[AUDIO].cpus = 2;
  },
  'unlimits PID count': (f) => {
    f.config.services[AUDIO].pids_limit = -1;
  },
  'adds read-write media': (f) => {
    f.config.services[AUDIO].volumes[0].read_only = false;
  },
  'creates missing host path': (f) => {
    f.config.services[AUDIO].volumes[0].bind.create_host_path = true;
  },
  'omits explicit create-host-path guard': (f) => {
    delete f.config.services[AUDIO].volumes[0].bind;
  },
  'changes media source': (f) => {
    f.config.services[AUDIO].volumes[0].source = '/etc';
  },
  'changes media target': (f) => {
    f.config.services[AUDIO].volumes[0].target = '/app';
  },
  'adds socket mount': (f) => {
    f.config.services[AUDIO].volumes.push({
      type: 'bind',
      source: '/var/run/docker.sock',
      target: '/var/run/docker.sock',
      read_only: true,
    });
  },
  'adds volume propagation': (f) => {
    f.config.services[AUDIO].volumes[0].bind.propagation = 'rshared';
  },
  'changes secret file': (f) => {
    f.config.secrets[SECRET].file = '/etc/shadow';
  },
  'uses external secret': (f) => {
    f.config.secrets[SECRET].external = true;
  },
  'uses secret from environment': (f) => {
    f.config.secrets[SECRET].environment = 'SIGNING_KEY';
  },
  'changes secret target': (f) => {
    f.config.services[AUDIO].secrets[0].target = '/app/code.mjs';
  },
  'adds another secret': (f) => {
    f.config.services[AUDIO].secrets.push({ source: 'stripe_secret_key' });
  },
  'omits explicit audio enablement': (f) => {
    delete f.config.services[AUDIO].environment.GAME_AUDIO_ENABLED;
  },
  'disables an enabled audio profile': (f) => {
    f.config.services[AUDIO].environment.GAME_AUDIO_ENABLED = 'false';
  },
  'points public runtime at original library': (f) => {
    f.config.services[AUDIO].environment.AUDIO_MEDIA_ROOT =
      '/private/media/assets/music';
  },
  'sets Node injected code': (f) => {
    f.config.services[AUDIO].environment.NODE_OPTIONS =
      '--require /private/media/extra.cjs';
  },
  'adds direct reverse-proxy host': (f) => {
    f.config.services[AUDIO].environment.VIRTUAL_HOST = 'audio.example';
  },
  'adds build secrets': (f) => {
    f.config.services[AUDIO].build.secrets = ['stripe_secret_key'];
  },
  'uses remote build': (f) => {
    f.config.services[AUDIO].build.context = 'https://example.test/repo';
  },
  'uses unreviewed image': (f) => {
    f.config.services[AUDIO].image = 'other-image:latest';
  },
  'uses unreviewed healthcheck command': (f) => {
    f.config.services[AUDIO].healthcheck.test = [
      'CMD-SHELL',
      'cat /run/secrets/game_audio_signing_key',
    ];
  },
  'disables healthcheck': (f) => {
    f.config.services[AUDIO].healthcheck.disable = true;
  },
  'changes temp mount': (f) => {
    f.config.services[AUDIO].tmpfs = ['/app'];
  },
  'uses another checkout media source': (f) => {
    f.expectedMediaSource = `${checkoutRoot}/public/assets/music`;
    f.config.services[AUDIO].volumes[0].source = f.expectedMediaSource;
  },
  'uses checkout secret': (f) => {
    f.expectedSecretFile = `${checkoutRoot}/secrets/audio`;
    f.config.secrets[SECRET].file = f.expectedSecretFile;
  },
  'exposes checkout parent': (f) => {
    f.expectedMediaSource = '/ci';
    f.config.services[AUDIO].volumes[0].source = f.expectedMediaSource;
  },
  'exposes host root': (f) => {
    f.expectedMediaSource = '/';
    f.config.services[AUDIO].volumes[0].source = '/';
  },
  'uses relative media': (f) => {
    f.expectedMediaSource = '../media';
  },
  'uses unnormalized media': (f) => {
    f.expectedMediaSource = '/srv/media/../media';
  },
  'places secret inside media': (f) => {
    f.expectedSecretFile = `${expectedMediaSource}/secret`;
    f.config.secrets[SECRET].file = f.expectedSecretFile;
  },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects: ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => assertGameAudioCompose(f));
  });
}
test('API bind ban survives enabling audio', () => {
  const f = fixture({ apiMode: true });
  f.config.services['gyaruinthemix-api'].volumes.push({
    type: 'bind',
    source: '/private',
    target: '/private',
  });
  assert.throws(() => assertGameAudioCompose(f));
});
test('disabled audio cannot secretly be present', () => {
  const f = fixture();
  f.audioEnabled = false;
  assert.throws(() => assertGameAudioCompose(f));
});
test('accepts only the explicitly approved checkout assets/music directory', () => {
  const f = fixture();
  f.expectedMediaSource = `${checkoutRoot}/assets/music`;
  f.config.services[AUDIO].volumes[0].source = f.expectedMediaSource;
  assert.doesNotThrow(() => assertGameAudioCompose(f));
});

for (const apiMode of [false, true])
  test(`accepts Compose JSON null command/entrypoint defaults api=${apiMode}`, () => {
    const f = fixture({ apiMode });
    f.config.services[AUDIO].command = null;
    f.config.services[AUDIO].entrypoint = null;
    assert.doesNotThrow(() => assertGameAudioCompose(f));
  });

for (const [name, serialization] of [
  [
    'explicit false and true',
    {
      disabled: { create_host_path: false },
      enabled: { create_host_path: true },
    },
  ],
  [
    'compose-go 2.7.1 omitted false',
    { disabled: {}, enabled: { create_host_path: true } },
  ],
  [
    'newer omitted true',
    { disabled: { create_host_path: false }, enabled: {} },
  ],
])
  test(`accepts only probed false bind representation: ${name}`, () => {
    const f = fixture();
    f.expectedMediaBindOptions = gameAudioFalseBindOptions(serialization);
    f.config.services[AUDIO].volumes[0].bind = structuredClone(
      serialization.disabled,
    );
    assert.doesNotThrow(() => assertGameAudioCompose(f));
    f.config.services[AUDIO].volumes[0].bind = structuredClone(
      serialization.enabled,
    );
    assert.throws(() => assertGameAudioCompose(f));
    delete f.config.services[AUDIO].volumes[0].bind;
    assert.throws(() => assertGameAudioCompose(f));
  });

test('omitted false without trusted serializer evidence still fails closed', () => {
  const f = fixture();
  f.config.services[AUDIO].volumes[0].bind = {};
  assert.throws(() => assertGameAudioCompose(f));
});

for (const [name, serialization] of [
  ['ambiguous omission', { disabled: {}, enabled: {} }],
  [
    'reversed meanings',
    {
      disabled: { create_host_path: true },
      enabled: { create_host_path: false },
    },
  ],
  [
    'unknown options',
    {
      disabled: { propagation: 'rshared' },
      enabled: { create_host_path: true },
    },
  ],
  [
    'missing bind',
    { disabled: undefined, enabled: { create_host_path: true } },
  ],
  ['null bind', { disabled: null, enabled: { create_host_path: true } }],
  [
    'string false',
    {
      disabled: { create_host_path: 'false' },
      enabled: { create_host_path: true },
    },
  ],
])
  test(`rejects unsafe serializer evidence: ${name}`, () => {
    assert.throws(() => gameAudioFalseBindOptions(serialization));
  });
