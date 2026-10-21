import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSceneUI, SCREENS } from '../public/game-test/src/scene-ui.js';
function root() {
  const nodes = new Map();
  return {
    body: { dataset: {} },
    querySelector(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          hidden: false,
          disabled: false,
          attrs: {},
          classList: { toggle() {} },
          setAttribute(k, v) {
            this.attrs[k] = v;
          },
        });
      return nodes.get(id);
    },
    querySelectorAll() {
      return ['boost', 'shoot', 'charge'].map((id) => this.querySelector(id));
    },
  };
}
test('scene transitions expose only their own overlays and release gameplay controls', () => {
  const document = root(),
    ui = createSceneUI(document);
  for (const scene of SCREENS) {
    ui.show(scene);
    assert.equal(document.body.dataset.screen, scene);
    for (const [id, name] of [
      ['#menu', 'menu'],
      ['#car-select', 'cars'],
      ['#route-panel', 'map'],
      ['#quiz', 'quiz'],
      ['#result', 'result'],
    ])
      assert.equal(document.querySelector(id).hidden, scene !== name);
    assert.equal(document.querySelector('boost').disabled, scene !== 'playing');
  }
  assert.throws(() => ui.show('endless'));
});
test('garage and route are separate views with matching accessible selection', () => {
  const document = root(),
    ui = createSceneUI(document);
  ui.mapPanel('garage');
  assert.equal(document.body.dataset.mapPanel, 'garage');
  assert.equal(document.querySelector('#route-content').hidden, true);
  assert.equal(document.querySelector('#garage-content').hidden, false);
  assert.equal(
    document.querySelector('#garage-tab').attrs['aria-pressed'],
    'true',
  );
  ui.mapPanel('route');
  assert.equal(document.querySelector('#garage-content').hidden, true);
});
test('replacement shell has unique stable IDs, safe-area viewport and genuine logical canvas dimensions', () => {
  const html = readFileSync(
      new URL('../public/game-test/index.html', import.meta.url),
      'utf8',
    ),
    ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    'route-tab',
    'garage-tab',
    'route-content',
    'garage-content',
    'game',
    'crew-actions',
    'depart',
    'story',
    'quiz',
    'pause-overlay',
  ])
    assert.ok(ids.includes(id));
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /id="game"\s+width="960"\s+height="540"/);
  assert.equal((html.match(/data-control=/g) || []).length, 3);
  const css = readFileSync(
    new URL('../public/game-test/style.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /133\.333%|left:\s*-16\.666%/);
});

test('car selection lives outside the route garage and has its own scene', () => {
  const html = readFileSync(
    new URL('../public/game-test/index.html', import.meta.url),
    'utf8',
  );
  assert.ok(SCREENS.includes('cars'));
  assert.ok(
    html.indexOf('id="car-select"') < html.indexOf('class="workspace"'),
  );
  const garage = html.slice(html.indexOf('id="garage-content"'));
  assert.ok(!garage.includes('id="car-garage"'));
  assert.ok(!garage.includes('id="car-customization"'));
});

test('pause focus trap includes the assist checkbox in both keyboard directions', () => {
  let listener,
    requested,
    focused,
    prevented = false;
  const control = (id) => ({
    id,
    hidden: false,
    getClientRects: () => [{}],
    focus() {
      focused = id;
    },
  });
  const checkbox = control('assist'),
    resume = control('resume'),
    quit = control('quit');
  const dialog = {
    hidden: false,
    contains: (node) => [checkbox, resume, quit].includes(node),
    querySelectorAll: (selector) => {
      requested = selector;
      return [checkbox, resume, quit];
    },
  };
  const doc = {
    body: { dataset: {} },
    activeElement: checkbox,
    addEventListener(name, fn) {
      listener = fn;
    },
    querySelector: (id) =>
      id === '#pause-overlay' ? dialog : { hidden: true },
  };
  createSceneUI(doc);
  listener({
    code: 'Tab',
    shiftKey: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.match(requested, /input:not\(:disabled\)/);
  assert.equal(prevented, true);
  assert.equal(focused, 'quit');
  doc.activeElement = quit;
  prevented = false;
  listener({
    code: 'Tab',
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(focused, 'assist');
  doc.activeElement = resume;
  prevented = false;
  listener({
    code: 'Tab',
    shiftKey: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(
    prevented,
    false,
    'native Shift+Tab can move from Resume to the checkbox',
  );
});
