import assert from 'node:assert/strict';
import { checkGameAudioRuntime } from './check-game-audio-runtime.mjs';
import { checkWwwRedirect } from './check-www-redirect.mjs';
import { checkGameTest } from './check-game-test.mjs';

// Run once in a fresh process for each container lifecycle phase. Never retain
// fetch/http keep-alive pools across the parent's synchronous Docker restarts.
const base = new URL(process.argv[2] || 'http://127.0.0.1:8089');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.username, '');
assert.equal(base.password, '');
assert.ok(['false', 'true'].includes(process.env.GAME_AUDIO_ENABLED));
await checkGameAudioRuntime(base, {
  enabled: process.env.GAME_AUDIO_ENABLED === 'true',
});
await checkWwwRedirect(base);
await checkGameTest(base);
