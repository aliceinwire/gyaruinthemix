import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSceneUI } from '../public/game-test/src/scene-ui.js';

function fixture() {
  const nodes = new Map();
  let keydown;
  const root = {
    body: { dataset: {} },
    activeElement: null,
    querySelector: (selector) => nodes.get(selector) || null,
    querySelectorAll: () => [nodes.get('drive')],
    addEventListener(type, callback) {
      if (type === 'keydown') keydown = callback;
    },
  };
  function node(id, options = {}) {
    const element = {
      hidden: true,
      disabled: false,
      children: [],
      classList: { toggle() {} },
      setAttribute() {},
      getClientRects: () => [{}],
      contains(item) {
        return this.children.includes(item);
      },
      querySelectorAll() {
        return this.children;
      },
      focus() {
        root.activeElement = this;
      },
      ...options,
    };
    nodes.set(id, element);
    return element;
  }
  for (const id of [
    '#story-panel',
    '#draft-panel',
    '#pause-overlay',
    '#pause',
    '#run-journal',
    'drive',
  ])
    node(id);
  const ui = createSceneUI(root);
  return {
    root,
    nodes,
    node,
    ui,
    press(event) {
      keydown(event);
    },
  };
}

test('story and draft stop driving controls and do not leave competing reading panels visible', () => {
  const { ui, root, nodes } = fixture();
  ui.show('playing');
  assert.equal(nodes.get('drive').disabled, false);
  assert.equal(nodes.get('#run-journal').disabled, false);
  ui.show('story');
  assert.equal(root.body.dataset.screen, 'story');
  assert.equal(nodes.get('#story-panel').hidden, false);
  assert.equal(nodes.get('#draft-panel').hidden, true);
  assert.equal(nodes.get('drive').disabled, true);
  assert.equal(nodes.get('#pause').disabled, true);
  assert.equal(nodes.get('#run-journal').disabled, true);
  ui.show('draft');
  assert.equal(nodes.get('#story-panel').hidden, true);
  assert.equal(nodes.get('#draft-panel').hidden, false);
  ui.show('map');
  assert.equal(nodes.get('#run-journal').disabled, false);
  assert.equal(nodes.get('#draft-panel').hidden, true);
});

test('a draft traps both tab directions and excludes unavailable choices', () => {
  const { root, nodes, node, ui, press } = fixture();
  const first = node('first', { hidden: false });
  const hidden = node('hidden');
  const last = node('last', { hidden: false });
  nodes.get('#draft-panel').children = [first, hidden, last];
  ui.show('draft');
  assert.equal(root.activeElement, first);
  let prevented = false;
  press({
    key: 'Tab',
    shiftKey: true,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(root.activeElement, last);
  press({ code: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(root.activeElement, first);
  root.activeElement = node('outside', { hidden: false });
  press({ key: 'Tab', shiftKey: false, preventDefault() {} });
  assert.equal(root.activeElement, first);
});

test('empty story panel receives focus until its buttons are populated', () => {
  const { root, nodes, ui, press } = fixture();
  ui.show('story');
  const panel = nodes.get('#story-panel');
  assert.equal(root.activeElement, panel);
  let prevented = false;
  press({
    key: 'Tab',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(root.activeElement, panel);
});

test('scene handling tolerates omitted optional panels during recovery', () => {
  const root = { body: { dataset: {} }, querySelector: () => null };
  const ui = createSceneUI(root);
  assert.doesNotThrow(() => {
    ui.show('story');
    ui.mapPanel('route');
    ui.focusPanel('#missing');
  });
  assert.equal(root.body.dataset.screen, 'story');
});

test('live world has no text overlays, while accessible story and draft panels retain stable controls', () => {
  const html = readFileSync(
    new URL('../public/game-test/index.html', import.meta.url),
    'utf8',
  );
  const viewport = html.slice(
    html.indexOf('<div class="viewport">'),
    html.indexOf('<div id="menu"'),
  );
  assert.match(viewport, /<canvas id="game"/);
  assert.doesNotMatch(
    viewport,
    /id="(?:toast|road-status|story-panel|draft-panel)"/,
  );
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    'story-panel',
    'story-kicker',
    'story-speaker',
    'story-text',
    'story-progress',
    'story-next',
    'story-skip',
    'story-choices',
    'story-history',
    'draft-panel',
    'draft-title',
    'draft-copy',
    'draft-options',
    'style-options',
    'rpg-status',
    'rpg-rank',
    'rpg-xp',
    'rpg-build',
    'run-journal',
    'reduced-motion',
    'assist-mode',
  ])
    assert.ok(ids.includes(id), id);
  assert.equal((html.match(/<iframe\b/g) || []).length, 0);
  assert.match(html, /<progress id="rpg-xp"/);
  assert.match(
    html,
    /<details class="story-log"><summary>[\s\S]*?<div id="story-history"/,
  );
});

test('the shared journal remains reachable when the route scene hides the cabinet', () => {
  const html = readFileSync(
    new URL('../public/game-test/index.html', import.meta.url),
    'utf8',
  );
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /id="run-journal"/);
  assert.doesNotMatch(
    html.slice(
      html.indexOf('<section class="cabinet"'),
      html.indexOf('<div id="performance-panel"'),
    ),
    /id="run-journal"/,
  );
  assert.match(html, /data-control="rush" class="rush">バウンスラッシュ/);
});
