import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { campaignEnvironment } from '../public/game-test/src/simulation.js';
import {
  getStoryScene,
  storyMemoryForRun,
  markStorySeen,
  chooseStoryOption,
  normalizeStoryMemory,
} from '../public/game-test/src/tour-story.js';
import { selectCrewDialogue } from '../public/game-test/src/crew-dialogue.js';
import { getJourneyChoices } from '../public/game-test/src/journey.js';

test('each tour keeps its season across all twelve roads, with reproducible changing weather', () => {
  let varied = false;
  for (let seed = 1; seed <= 80; seed++) {
    const conditions = Array.from({ length: 12 }, (_, road) =>
      campaignEnvironment(seed, road),
    );
    assert.equal(new Set(conditions.map((item) => item.season)).size, 1);
    if (new Set(conditions.map((item) => item.weather)).size > 1) varied = true;
    for (let road = 0; road < 12; road++)
      assert.deepEqual(conditions[road], campaignEnvironment(seed, road));
  }
  assert.equal(varied, true);
});

test('repeat tours get their own choices and recordings while a resumed tour retains both', () => {
  let memory = storyMemoryForRun({}, 'first-tour');
  memory = chooseStoryOption(
    memory,
    getStoryScene({}, 'opening', memory),
    'crew',
  );
  memory = markStorySeen(memory, 'arrival:1');
  const resumed = storyMemoryForRun(JSON.stringify(memory), 'first-tour');
  assert.deepEqual(resumed, memory);
  assert.equal(
    getStoryScene({ routeIndex: 1, status: 'won' }, 'arrival', resumed),
    null,
  );
  const next = storyMemoryForRun(memory, 'next-tour');
  assert.deepEqual(next, { ...normalizeStoryMemory(), runId: 'next-tour' });
  assert.ok(getStoryScene({}, 'opening', next));
  assert.equal(
    chooseStoryOption(next, getStoryScene({}, 'opening', next), 'discovery')
      .choices['tour:opening'],
    'discovery',
  );
  assert.equal(memory.choices['tour:opening'], 'crew');
});

test('invalid run identities cannot pollute story memory', () => {
  const memory = markStorySeen({}, 'arrival:1');
  for (const id of [null, '', {}, 'x'.repeat(201)])
    assert.deepEqual(storyMemoryForRun(memory, id), memory);
});

test('road dialogue follows the selected map service instead of the generic express flag', () => {
  for (const node of getJourneyChoices(3, 175)) {
    const line = selectCrewDialogue({
      time: 8,
      journeyNodeId: node.nodeId,
      routeOption: node.routeOption,
    });
    assert.match(line.id, new RegExp(`^road:${node.kind}:`));
    if (node.kind === 'event') assert.match(line.text, /人波多め/);
    if (node.kind === 'service') assert.match(line.text, /車を直して/);
  }
});

test('Kyoto approach recalls five club recordings before the sixth soundcheck', () => {
  const line = selectCrewDialogue({ time: 0, cityId: 'kyoto' });
  assert.match(line.text, /五つのクラブ/);
  const last = getStoryScene({ routeIndex: 11, status: 'won' }, 'arrival');
  assert.match(last.lines.map((line) => line.text).join(' '), /六つのクラブ/);
});

test('legacy mid-tour journals migrate without losing their focus or completed stops', () => {
  const legacy = chooseStoryOption({}, getStoryScene({}, 'opening'), 'crew');
  const current = markStorySeen(legacy, 'arrival:3');
  assert.deepEqual(storyMemoryForRun(current, 'restored-tour', 4), {
    ...current,
    runId: 'restored-tour',
  });
  assert.deepEqual(storyMemoryForRun(current, 'new-tour', 0).seen, []);
});

test('static tour labels describe six club stops rather than six cities', () => {
  const html = readFileSync(
    new URL('../public/game-test/index.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /6 CLUBS/);
  assert.doesNotMatch(html, /6 CITIES|6つの街|六つの街/);
});
