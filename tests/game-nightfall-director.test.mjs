import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoryDirector,
  STORY_SAVE_KEY,
  normalizeStorySave,
} from '../public/game/src/tour-director.js';
import {
  markStorySeen,
  normalizeStoryMemory,
} from '../public/game/src/tour-story.js';

function fixture({
  memory,
  state = { routeIndex: 0, status: 'playing' },
  failRead = false,
  failWrite = false,
} = {}) {
  const nodes = new Map(),
    writes = [];
  const counts = { opened: 0, completed: 0, saveErrors: 0 };
  const root = {
    activeElement: null,
    querySelector: (selector) => nodes.get(selector) || null,
    createElement: (tag) => node(tag),
  };
  function node(tag = 'div') {
    const listeners = new Map();
    return {
      tagName: tag,
      textContent: '',
      hidden: false,
      children: [],
      dataset: {},
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      dispatch(type, properties = {}) {
        const event = {
          defaultPrevented: false,
          propagationStopped: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopPropagation() {
            this.propagationStopped = true;
          },
          ...properties,
        };
        for (const callback of listeners.get(type) || []) callback(event);
        return event;
      },
      click() {
        this.dispatch('click');
      },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      querySelector(selector) {
        return (
          this.children.find((child) => child.tagName === selector) || null
        );
      },
      focus() {
        root.activeElement = this;
      },
      scrollIntoView() {},
    };
  }
  for (const id of [
    'story-panel',
    'story-kicker',
    'story-speaker',
    'story-text',
    'story-progress',
    'story-choices',
    'story-next',
    'story-skip',
    'story-history',
  ]) {
    nodes.set(
      `#${id}`,
      node(id === 'story-next' || id === 'story-skip' ? 'button' : 'div'),
    );
  }
  const storage = {
    getItem(key) {
      assert.equal(key, STORY_SAVE_KEY);
      if (failRead) throw new Error('Storage denied');
      return memory === undefined ? null : JSON.stringify(memory);
    },
    setItem(key, value) {
      assert.equal(key, STORY_SAVE_KEY);
      if (failWrite) throw new Error('Storage quota exceeded');
      writes.push(JSON.parse(value));
    },
  };
  const director = createStoryDirector({
    root,
    storage,
    getState: () => state,
    onOpen() {
      counts.opened++;
    },
    onSaveError() {
      counts.saveErrors++;
    },
  });
  return {
    director,
    root,
    writes,
    counts,
    state,
    get: (id) => nodes.get(`#${id}`),
    complete() {
      counts.completed++;
    },
  };
}

function fullJournal() {
  let memory = normalizeStoryMemory();
  for (let entry = 0; entry < 48; entry++)
    memory = markStorySeen(memory, `departure:${entry % 12}`);
  assert.equal(memory.history.length, 48);
  return memory;
}

test('dialogue advances at the reader pace, completes once, and skips a remembered scene', () => {
  const { director, get, counts, writes, complete, root } = fixture();
  assert.equal(director.show('departure', complete), true);
  assert.equal(director.active, true);
  assert.equal(counts.opened, 1);
  assert.equal(get('story-progress').textContent, '1 / 2');
  assert.equal(root.activeElement, get('story-next'));
  const firstLine = get('story-text').textContent;
  assert.ok(firstLine.length > 0);
  assert.equal(director.memory.seen.length, 0);
  get('story-next').click();
  assert.equal(get('story-progress').textContent, '2 / 2');
  assert.notEqual(get('story-text').textContent, firstLine);
  assert.equal(counts.completed, 0);
  assert.equal(writes.length, 0);
  get('story-next').click();
  assert.equal(director.active, false);
  assert.equal(counts.completed, 1);
  assert.deepEqual(director.memory.history, ['departure:0']);
  assert.equal(writes.length, 1);
  get('story-next').click();
  get('story-skip').click();
  assert.equal(
    counts.completed,
    1,
    'Queued clicks cannot complete a closed scene again',
  );
  assert.equal(director.show('departure', complete), false);
  assert.equal(
    counts.completed,
    2,
    'Already-seen scenes still hand control back to the host',
  );
  assert.equal(counts.opened, 1);
  assert.equal(writes.length, 1);
});

test('closing opening dialogue reaches its required choice and cannot bypass or repeat it', () => {
  const { director, get, counts, writes, complete, root } = fixture();
  director.show('opening', complete);
  assert.equal(get('story-choices').children.length, 0);
  get('story-skip').click();
  const choices = [...get('story-choices').children];
  assert.equal(choices.length, 2);
  assert.equal(get('story-next').hidden, true);
  assert.equal(get('story-skip').hidden, true);
  assert.equal(root.activeElement, choices[0]);
  get('story-next').click();
  get('story-panel').dispatch('keydown', { code: 'Escape' });
  assert.equal(director.active, true);
  assert.equal(counts.completed, 0);
  assert.deepEqual(director.memory.choices, {});
  choices[0].click();
  choices[1].click();
  get('story-next').click();
  assert.equal(counts.completed, 1);
  assert.equal(director.active, false);
  assert.equal(director.memory.choices['tour:opening'], 'crew');
  assert.deepEqual(director.memory.history, ['tour:opening']);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].current, director.memory);
  assert.deepEqual(writes[0].archive, director.archive);
});

test('holding a reading key cannot advance dialogue repeatedly', () => {
  const { director, get, counts, complete } = fixture();
  director.show('departure', complete);
  for (const code of ['Enter', 'Space']) {
    assert.equal(
      get('story-panel').dispatch('keydown', { code, repeat: true })
        .defaultPrevented,
      true,
    );
    assert.equal(
      get('story-panel').dispatch('keydown', { code, repeat: false })
        .defaultPrevented,
      false,
    );
  }
  assert.equal(get('story-progress').textContent, '1 / 2');
  assert.equal(counts.completed, 0);
});

test('a long journal closes immediately from its first entry without changing story memory', () => {
  const memory = fullJournal();
  const { director, get, counts, writes, complete } = fixture({
    memory: { version: 3, current: memory, archive: memory },
  });
  assert.equal(director.journal(complete), true);
  assert.equal(get('story-progress').textContent, '1 / 48');
  assert.equal(get('story-skip').hidden, false);
  assert.equal(get('story-skip').textContent, '記録を閉じる');
  get('story-skip').click();
  get('story-skip').click();
  assert.equal(director.active, false);
  assert.equal(counts.completed, 1);
  assert.deepEqual(director.memory, memory);
  assert.deepEqual(writes, []);
});

test('Escape closes a long journal at any entry and the next scene still requires its choice', () => {
  const { director, get, counts, writes, complete } = fixture({
    memory: { version: 3, current: fullJournal(), archive: fullJournal() },
  });
  director.journal(complete);
  get('story-next').click();
  assert.equal(get('story-progress').textContent, '2 / 48');
  const escape = get('story-panel').dispatch('keydown', { code: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(
    escape.propagationStopped,
    true,
    'Escape cannot reach the global pause toggle after the journal closes',
  );
  get('story-panel').dispatch('keydown', { code: 'Escape' });
  assert.equal(director.active, false);
  assert.equal(counts.completed, 1);
  assert.deepEqual(writes, []);
  director.show('opening', complete);
  assert.equal(
    get('story-panel').dispatch('keydown', { code: 'Escape' }).defaultPrevented,
    false,
  );
  get('story-skip').click();
  assert.equal(director.active, true);
  assert.equal(get('story-choices').children.length, 2);
  assert.equal(counts.completed, 1);
});

test('new tours have a fresh album and choice while prior tours remain archived', () => {
  const { director, get, state, writes, complete } = fixture({
    state: { routeIndex: 0, status: 'playing', runId: 'first-tour' },
  });
  director.show('opening', complete);
  get('story-skip').click();
  get('story-choices').children[0].click();
  state.routeIndex = 5;
  state.status = 'won';
  director.show('arrival', complete);
  get('story-skip').click();
  assert.ok(director.memory.history.includes('arrival:5'));

  state.runId = 'second-tour';
  state.routeIndex = 0;
  state.status = 'playing';
  assert.equal(director.show('opening', complete), true);
  assert.deepEqual(director.memory.seen, []);
  get('story-skip').click();
  get('story-choices').children[1].click();
  assert.equal(director.memory.choices['tour:returning'], 'discovery');
  assert.equal(director.memory.choices['tour:opening'], undefined);
  assert.deepEqual(director.memory.history, ['tour:returning']);
  assert.ok(director.archive.seen.includes('arrival:5'));
  assert.equal(writes.at(-1).runId, 'second-tour');
  assert.equal(director.show('opening', complete), false);

  director.journal(complete);
  assert.equal(get('story-panel').dataset.journal, 'true');
  assert.equal(get('story-progress').textContent, '1 / 1');
  get('story-skip').click();
  director.show('departure', complete);
  assert.equal(get('story-panel').dataset.journal, 'false');
});

test('resume preserves seen scenes even when menu snapshots inspect the loaded story first', () => {
  const current = markStorySeen({}, 'departure:0');
  const stored = { version: 3, runId: 'saved-tour', current, archive: current };
  const { director, state, counts, complete } = fixture({
    memory: stored,
    state: { runId: 'menu-placeholder', routeIndex: 0, status: 'playing' },
  });
  assert.deepEqual(director.memory, current);
  state.runId = 'saved-tour';
  assert.equal(director.show('departure', complete), false);
  assert.equal(counts.opened, 0);
  assert.equal(counts.completed, 1);
  assert.deepEqual(director.memory, current);
});

test('old global journals migrate into an archive without leaking later stops into a new tour', () => {
  const old = markStorySeen(markStorySeen({}, 'tour:opening'), 'arrival:11');
  const normalized = normalizeStorySave(JSON.stringify(old));
  assert.deepEqual(normalized.current, normalizeStoryMemory());
  assert.deepEqual(normalized.archive, old);
  const { director, get, complete } = fixture({
    memory: old,
    state: { runId: 'new-tour', routeIndex: 0 },
  });
  director.journal(complete);
  assert.equal(get('story-progress').textContent, '1 / 1');
  assert.match(get('story-text').textContent, /一枚目/);
  assert.equal(get('story-history').children.length, 0);
  get('story-skip').click();
  assert.equal(director.show('opening', complete), true);
  get('story-skip').click();
  get('story-choices').children[0].click();
  assert.deepEqual(director.memory.seen, ['tour:returning']);
  assert.ok(director.archive.seen.includes('arrival:11'));
});

test('unavailable browser storage does not block reading, choices, or host continuation', () => {
  const { director, get, counts, complete } = fixture({
    failRead: true,
    failWrite: true,
  });
  assert.deepEqual(director.memory, normalizeStoryMemory());
  assert.doesNotThrow(() => {
    director.show('opening', complete);
    get('story-skip').click();
    get('story-choices').children[0].click();
  });
  assert.equal(director.active, false);
  assert.equal(counts.completed, 1);
  assert.equal(counts.saveErrors, 1);
  assert.equal(director.memory.choices['tour:opening'], 'crew');
  assert.equal(director.show('opening', complete), false);
  assert.equal(counts.completed, 2);
});

test('director binds scenes to the active run without replaying a resumed scene', () => {
  const state = { routeIndex: 1, status: 'won', runId: 'tour-a' };
  const memory = { ...markStorySeen({}, 'arrival:1'), runId: 'tour-a' };
  const view = fixture({ state, memory });
  assert.equal(view.director.show('arrival', view.complete), false);
  assert.equal(view.counts.completed, 1);
  state.runId = 'tour-b';
  state.routeIndex = 0;
  state.status = 'playing';
  assert.equal(view.director.show('opening', view.complete), true);
  assert.equal(view.director.memory.runId, 'tour-b');
  assert.deepEqual(view.director.memory.seen, []);
  assert.equal(view.writes.at(-1).runId, 'tour-b');
  assert.equal(view.director.show('departure', view.complete), false);
});

test('the director adopts an unbound legacy journal when resuming either tour mode', () => {
  for (const mode of ['story', 'survival']) {
    const state = {
      mode,
      routeIndex: 4,
      status: 'playing',
      runId: 'legacy-resume',
    };
    const memory = {
      ...markStorySeen(markStorySeen({}, 'arrival:3'), 'departure:4'),
      choices: { 'tour:opening': 'discovery' },
    };
    const { director } = fixture({ state, memory });
    director.beginRun();
    assert.equal(director.memory.choices['tour:opening'], 'discovery', mode);
    assert.ok(director.memory.seen.includes('arrival:3'), mode);
    assert.ok(director.memory.history.includes('arrival:3'), mode);
    assert.ok(director.memory.seen.includes('departure:4'), mode);
    assert.equal(director.memory.runId, state.runId, mode);
  }
});

test('unbound journals with future scenes remain archives when resuming either tour mode', () => {
  for (const mode of ['story', 'survival']) {
    for (const field of ['seen', 'history']) {
      for (const future of [
        'departure:5',
        'arrival:5',
        'retry:5:first',
        'tour:finale',
      ]) {
        const memory = {
          ...markStorySeen({}, 'arrival:3'),
          choices: { 'tour:opening': 'discovery' },
        };
        memory[field].push(future);
        const { director } = fixture({
          memory,
          state: {
            mode,
            routeIndex: 4,
            status: 'playing',
            runId: 'resumed-tour',
          },
        });
        director.beginRun();
        assert.deepEqual(
          director.memory.seen,
          [],
          `${mode}/${field}/${future}`,
        );
        assert.deepEqual(director.memory.history, []);
        assert.deepEqual(director.memory.choices, {});
        assert.equal(director.memory.runId, 'resumed-tour');
        assert.ok(director.archive[field].includes(future));
      }
    }
  }
});
