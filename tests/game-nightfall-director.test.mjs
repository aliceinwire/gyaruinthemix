import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoryDirector,
  STORY_SAVE_KEY,
} from '../public/game-test/src/tour-director.js';
import {
  markStorySeen,
  normalizeStoryMemory,
} from '../public/game-test/src/tour-story.js';

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
  assert.deepEqual(writes[0], director.memory);
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
  const { director, get, counts, writes, complete } = fixture({ memory });
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
    memory: fullJournal(),
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
