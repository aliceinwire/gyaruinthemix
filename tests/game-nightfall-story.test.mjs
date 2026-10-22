import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStoryScene,
  getStoryJournal,
  normalizeStoryMemory,
  markStorySeen,
  chooseStoryOption,
  STORY_SPEAKERS,
} from '../public/game-test/src/tour-story.js';
import {
  selectCrewDialogue,
  selectCrewEvent,
} from '../public/game-test/src/crew-dialogue.js';
import { getJourneyStage } from '../public/game-test/src/journey.js';

test('the club tour carries original hard bounce and Heisei gyaru culture through all six club stops', () => {
  const opening = getStoryScene({ mode: 'survival' }, 'opening');
  const premise = opening.lines.map((line) => line.text).join(' ');
  for (const theme of [
    '会社',
    '平成ギャル',
    'ハードバウンス',
    'オリジナル曲',
    '175 BPM',
  ])
    assert.ok(premise.includes(theme), theme);
  for (let routeIndex = 1; routeIndex < 12; routeIndex += 2) {
    const stage = getJourneyStage(routeIndex);
    const arrival = getStoryScene(
      { routeIndex, status: 'won', mode: 'survival' },
      'arrival',
    );
    const text = arrival.lines.map((line) => line.text).join(' ');
    assert.ok(arrival.kicker.includes(stage.club));
    assert.ok(text.includes(stage.cityName));
    assert.match(text, /サウンドチェック|録音/);
    assert.match(text, /踊|跳|セット|手拍子|プレイ/);
  }
  const finale = getStoryScene(
    { routeIndex: 11, status: 'won', mode: 'survival' },
    'finale',
  );
  assert.match(
    finale.lines.map((line) => line.text).join(' '),
    /六つ.*つながった/,
  );
});

test('one-life runs never offer legacy road-retry dialogue', () => {
  assert.equal(
    getStoryScene({ routeIndex: 3, status: 'lost', mode: 'survival' }, 'retry'),
    null,
  );
  assert.ok(
    getStoryScene({ routeIndex: 3, status: 'lost', mode: 'story' }, 'retry'),
  );
});

test('automatic weapons leave room for ambient dialogue while urgent events retain priority', () => {
  const context = {
    mode: 'survival',
    shooting: true,
    time: 0,
    cityId: 'nakano',
  };
  assert.match(selectCrewDialogue(context).id, /^city:nakano:/);
  assert.equal(selectCrewEvent([{ type: 'shoot' }], context), null);
  assert.match(
    selectCrewEvent([{ type: 'shoot' }, { type: 'collision' }], context).id,
    /event:collision/,
  );
  assert.match(selectCrewEvent('shoot', { mode: 'story' }).id, /event:shoot/);
});

test('opening is optional, coherent, and shown once without consuming it during selection', () => {
  const state = Object.freeze({ routeIndex: 0, status: 'playing', seed: 175 });
  const memory = Object.freeze({ seen: Object.freeze([]) });
  const opening = getStoryScene(state, 'opening', memory);
  assert.equal(opening.id, 'tour:opening');
  assert.deepEqual(getStoryScene(state, 'opening', memory), opening);
  assert.equal(
    getStoryScene(state, 'opening', markStorySeen(memory, opening.id)),
    null,
  );
  assert.equal(getStoryScene({ routeIndex: 2 }, 'opening'), null);
  assert.match(
    opening.lines.map((line) => line.text).join(' '),
    /都市間は別の日/,
  );
});

test('memory normalization rejects malformed and unknown persistent data', () => {
  const clean = normalizeStoryMemory({
    version: -1,
    seen: ['arrival:1', 'arrival:1', '<script>', null, 100],
    choices: { 'tour:opening': 'grant-money', 'arrival:1': 'repair' },
    history: ['arrival:1', {}, 'fake'],
  });
  assert.deepEqual(clean, {
    version: 1,
    seen: ['arrival:1'],
    choices: {},
    history: ['arrival:1'],
  });
  for (const value of [null, [], '{broken', false, 1]) {
    assert.deepEqual(normalizeStoryMemory(value), {
      version: 1,
      seen: [],
      choices: {},
      history: [],
    });
  }
  assert.deepEqual(normalizeStoryMemory(JSON.stringify(clean)), clean);
});

test('story choices change later dialogue, not simulation state or rewards', () => {
  const state = Object.freeze({
    routeIndex: 0,
    money: 50,
    totalFans: 3,
    runBuild: Object.freeze({}),
  });
  const empty = normalizeStoryMemory();
  const opening = getStoryScene(state, 'opening', empty);
  const crew = chooseStoryOption(empty, opening, 'crew');
  const discovery = chooseStoryOption(empty, opening, 'discovery');
  assert.deepEqual(empty.choices, {});
  assert.equal(crew.choices['tour:opening'], 'crew');
  assert.equal(discovery.choices['tour:opening'], 'discovery');
  const arrived = { routeIndex: 5, status: 'won' };
  assert.notDeepEqual(
    getStoryScene(arrived, 'arrival', crew).lines,
    getStoryScene(arrived, 'arrival', discovery).lines,
  );
  assert.deepEqual(state, {
    routeIndex: 0,
    money: 50,
    totalFans: 3,
    runBuild: {},
  });
  assert.ok(
    opening.choices.every((choice) => !Object.hasOwn(choice, 'effect')),
  );
});

test('invalid or forged choices cannot enter memory and an existing decision cannot be replayed', () => {
  const empty = normalizeStoryMemory();
  const scene = getStoryScene({}, 'opening');
  assert.deepEqual(chooseStoryOption(empty, scene, 'repair'), empty);
  assert.deepEqual(
    chooseStoryOption(empty, { id: 'fake', choices: [{ id: 'crew' }] }, 'crew'),
    empty,
  );
  const chosen = chooseStoryOption(empty, scene, 'crew');
  assert.deepEqual(chooseStoryOption(chosen, scene, 'discovery'), chosen);
  assert.deepEqual(chooseStoryOption(chosen, scene, 'crew'), chosen);
});

test('twelve roads lead to exactly six soundchecks, all after successful club arrivals', () => {
  const recordings = [];
  let memory = normalizeStoryMemory();
  for (let routeIndex = 0; routeIndex < 12; routeIndex++) {
    const departure = getStoryScene({ routeIndex }, 'departure', memory);
    assert.ok(departure);
    assert.equal(
      getStoryScene({ routeIndex, status: 'playing' }, 'arrival', memory),
      null,
    );
    assert.equal(
      getStoryScene({ routeIndex, status: 'lost' }, 'arrival', memory),
      null,
    );
    const arrival = getStoryScene(
      { routeIndex, status: 'won' },
      'arrival',
      memory,
    );
    assert.ok(arrival);
    if (arrival.kicker.startsWith('SOUNDCHECK')) recordings.push(routeIndex);
    memory = markStorySeen(markStorySeen(memory, departure.id), arrival.id);
    assert.equal(
      getStoryScene({ routeIndex, status: 'won' }, 'arrival', memory),
      null,
    );
  }
  assert.deepEqual(recordings, [1, 3, 5, 7, 9, 11]);
  assert.equal(getStoryJournal(memory).length, 24);
});

test('the Tokyo-to-Kansai transition includes transfer and rest between tour nights', () => {
  const exit = getStoryScene({ routeIndex: 7, status: 'won' }, 'arrival');
  const entry = getStoryScene({ routeIndex: 8 }, 'departure');
  assert.match(
    exit.lines.map((line) => line.text).join(' '),
    /長距離移動は次の日程/,
  );
  assert.match(entry.lines.map((line) => line.text).join(' '), /移動と休息/);
});

test('retry reacts once with explanation, then uses shorter repeat dialogue', () => {
  const lost = Object.freeze({ routeIndex: 4, status: 'lost' });
  const first = getStoryScene(lost, 'retry');
  const after = markStorySeen({}, first.id);
  const again = getStoryScene(lost, 'retry', after);
  assert.notEqual(first.id, again.id);
  assert.ok(again.lines.length < first.lines.length);
  assert.deepEqual(getStoryScene(lost, 'retry', after), again);
  assert.equal(getStoryScene({ routeIndex: 4, status: 'won' }, 'retry'), null);
});

test('finale cannot precede winning the last road and is shown once', () => {
  for (const state of [
    { routeIndex: 9, status: 'won' },
    { routeIndex: 11, status: 'lost' },
    { routeIndex: 11, status: 'playing' },
  ]) {
    assert.equal(getStoryScene(state, 'finale'), null);
  }
  const state = { routeIndex: 11, status: 'won' };
  const final = getStoryScene(state, 'finale');
  assert.ok(final);
  assert.equal(
    getStoryScene(state, 'finale', markStorySeen({}, final.id)),
    null,
  );
});

test('journal is bounded plain data and mutations to selected scenes cannot alter the catalog', () => {
  let memory = normalizeStoryMemory();
  for (let i = 0; i < 100; i++)
    memory = markStorySeen(memory, `departure:${i % 12}`);
  assert.equal(memory.history.length, 48);
  const journal = getStoryJournal(memory);
  assert.ok(
    journal.every(
      (item) =>
        typeof item.summary === 'string' && typeof item.kicker === 'string',
    ),
  );
  const opening = getStoryScene({}, 'opening');
  opening.lines[0].text = 'changed';
  opening.choices[0].label = 'changed';
  const again = getStoryScene({}, 'opening');
  assert.notEqual(again.lines[0].text, 'changed');
  assert.notEqual(again.choices[0].label, 'changed');
});

test('story speaks in the two established voices and invitations never coerce identity', () => {
  const all = [];
  for (let routeIndex = 0; routeIndex < 12; routeIndex++) {
    for (const trigger of [
      'opening',
      'returning',
      'breakdown',
      'departure',
      'arrival',
      'retry',
      'finale',
    ]) {
      const scene = getStoryScene(
        {
          routeIndex,
          status: ['retry', 'breakdown'].includes(trigger) ? 'lost' : 'won',
        },
        trigger,
      );
      if (scene) all.push(...scene.lines);
    }
  }
  assert.ok(all.every((line) => Object.hasOwn(STORY_SPEAKERS, line.speaker)));
  assert.ok(
    all.every(
      (line) => !/[♡♥❤]|ギャル化|ギャルに変|全員ギャル/.test(line.text),
    ),
  );
  assert.match(all.map((line) => line.text).join(' '), /好きな格好/);
  assert.equal(getStoryScene({ routeIndex: NaN }, 'departure'), null);
  assert.equal(getStoryScene({ routeIndex: 12 }, 'departure'), null);
  assert.equal(getStoryScene({}, 'unknown'), null);
});

test('existing crew selectors preserve priority and event arrays without decorative emoji', () => {
  const events = Object.freeze([{ type: 'convert' }, { type: 'collision' }]);
  const selected = selectCrewEvent(events, { time: 1 });
  assert.match(selected.id, /event:collision/);
  assert.equal(events.length, 2);
  assert.equal(selectCrewEvent('unrelated'), null);
  for (let time = 0; time < 160; time += 8) {
    const dialogue = selectCrewDialogue({
      time,
      cityId: 'osaka',
      season: 'spring',
    });
    assert.equal(typeof dialogue.text, 'string');
    assert.ok(!/[♡♥❤]/.test(dialogue.text));
  }
  assert.match(selectCrewEvent('convert', { time: 0 }).text, /招待/);
});

test('returning tours choose a new narrative focus without borrowing previous-run events', () => {
  const state = Object.freeze({
    routeIndex: 0,
    status: 'playing',
    mode: 'survival',
  });
  const returning = getStoryScene(state, 'returning');
  const opening = getStoryScene(state, 'opening');
  assert.equal(returning.id, 'tour:returning');
  assert.ok(returning.lines.length < opening.lines.length);
  assert.deepEqual(returning.choices, opening.choices);
  assert.equal(getStoryScene({ routeIndex: 2 }, 'returning'), null);
  assert.equal(
    getStoryScene(state, 'returning', markStorySeen({}, returning.id)),
    null,
  );
  const crew = chooseStoryOption({}, returning, 'crew');
  const discovery = chooseStoryOption({}, returning, 'discovery');
  assert.equal(crew.choices['tour:returning'], 'crew');
  assert.equal(crew.choices['tour:opening'], undefined);
  assert.notDeepEqual(
    getStoryScene({ routeIndex: 5, status: 'won' }, 'arrival', crew).lines,
    getStoryScene({ routeIndex: 5, status: 'won' }, 'arrival', discovery).lines,
  );
  assert.deepEqual(crew.history, ['tour:returning']);
});

test('a breakdown closes only a lost attempt and never claims a midroad retry', () => {
  const lost = Object.freeze({
    routeIndex: 7,
    status: 'lost',
    mode: 'survival',
  });
  for (const status of ['playing', 'draft', 'quiz', 'won']) {
    assert.equal(getStoryScene({ ...lost, status }, 'breakdown'), null);
  }
  const scene = getStoryScene(lost, 'breakdown');
  assert.equal(scene.id, 'tour:breakdown');
  assert.equal(scene.choices, undefined);
  const text = scene.lines.map((line) => line.text).join(' ');
  assert.match(text, /無事/);
  assert.match(text, /中野/);
  assert.doesNotMatch(text, /巻き戻|この道.*再挑戦|死亡|復活/);
  assert.equal(
    getStoryScene(lost, 'breakdown', markStorySeen({}, scene.id)),
    null,
  );
  assert.equal(lost.status, 'lost');
});
