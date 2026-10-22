import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEM_ICON_IDS,
  ITEM_ICON_SIZE,
  hasItemIcon,
  itemIconRects,
  createItemIcon,
  drawItemIcon,
} from '../public/game-test/src/item-icons.js';
import {
  SURVIVAL_UPGRADES,
  SURVIVAL_EVOLUTIONS,
} from '../public/game-test/src/survival.js';
import { RUN_MOD_CATALOG } from '../public/game-test/src/run-build.js';
import { RUN_STYLES, PERK_CATALOG } from '../public/game-test/src/tour-rpg.js';
import {
  CAR_CATALOG,
  STARTING_UPGRADE_CATALOG,
  PAINT_OPTIONS,
  WHEEL_OPTIONS,
  DECAL_OPTIONS,
} from '../public/game-test/src/garage.js';
import { UPGRADE_CATALOG } from '../public/game-test/src/simulation.js';

test('each selectable equipment and cosmetic has an explicit pixel icon', () => {
  const equipment = [
    SURVIVAL_UPGRADES,
    SURVIVAL_EVOLUTIONS,
    RUN_MOD_CATALOG,
    RUN_STYLES,
    PERK_CATALOG,
    CAR_CATALOG,
    STARTING_UPGRADE_CATALOG,
    UPGRADE_CATALOG,
  ].flat();
  for (const item of equipment) assert.ok(hasItemIcon(item.id), item.id);
  for (const [kind, options] of [
    ['paint', PAINT_OPTIONS],
    ['wheels', WHEEL_OPTIONS],
    ['decal', DECAL_OPTIONS],
  ])
    for (const item of options)
      assert.ok(hasItemIcon(`${kind}:${item.id}`), `${kind}:${item.id}`);
});

test('icons fit the 32 pixel view box and weapons have distinct silhouettes', () => {
  for (const id of ITEM_ICON_IDS) {
    const pixels = itemIconRects(id);
    assert.ok(pixels.length > 0, id);
    assert.ok(Object.isFrozen(pixels), id);
    for (const pixel of pixels) {
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(Number.isInteger(pixel[key]), `${id}: ${key}`);
      assert.ok(pixel.x >= 0 && pixel.y >= 0, id);
      assert.ok(pixel.width > 0 && pixel.height > 0, id);
      assert.ok(pixel.x + pixel.width <= ITEM_ICON_SIZE, id);
      assert.ok(pixel.y + pixel.height <= ITEM_ICON_SIZE, id);
      assert.match(pixel.color, /^#[a-f\d]{6}$/i, id);
    }
  }
  const weapons = [
    'heart',
    'flash',
    'vinyl',
    'bass',
    'phone',
    'echo',
    'heartstorm',
    'flashmob',
    'encore',
    'afterparty',
    'hotline',
  ];
  assert.equal(
    new Set(weapons.map((id) => JSON.stringify(itemIconRects(id)))).size,
    weapons.length,
  );
  assert.equal(hasItemIcon('missing-item'), false);
  assert.deepEqual(itemIconRects('missing-item'), itemIconRects('hype'));
});

test('SVG and canvas draw the same pixels without adding controls or external assets', () => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElementNS(ns, tag) {
      return {
        ns,
        tag,
        attributes: {},
        children: [],
        setAttribute(key, value) {
          this.attributes[key] = String(value);
        },
        append(child) {
          this.children.push(child);
        },
      };
    },
  };
  try {
    const icon = createItemIcon('flash', { size: 48 });
    assert.equal(icon.tag, 'svg');
    assert.equal(icon.attributes['aria-hidden'], 'true');
    assert.equal(icon.attributes.focusable, 'false');
    assert.equal(icon.attributes.width, '48');
    assert.equal(icon.attributes.height, '48');
    assert.equal(icon.attributes.viewBox, '0 0 32 32');
    assert.equal(icon.children.length, itemIconRects('flash').length);
    const calls = [],
      state = [];
    const context = {
      fillStyle: '#000000',
      save() {
        state.push(this.fillStyle);
      },
      restore() {
        this.fillStyle = state.pop();
      },
      fillRect(x, y, width, height) {
        calls.push({ x, y, width, height, color: this.fillStyle });
      },
    };
    drawItemIcon(context, 'flash', 10, 20, 48);
    assert.equal(context.fillStyle, '#000000');
    assert.equal(state.length, 0);
    icon.children.forEach(({ tag, attributes }, index) => {
      assert.equal(tag, 'rect');
      assert.equal(attributes.href, undefined);
      assert.deepEqual(calls[index], {
        x: 10 + Number(attributes.x) * 1.5,
        y: 20 + Number(attributes.y) * 1.5,
        width: Number(attributes.width) * 1.5,
        height: Number(attributes.height) * 1.5,
        color: attributes.fill,
      });
    });
    assert.equal(
      createItemIcon('unknown').attributes['data-item-icon'],
      'hype',
    );
    assert.equal(createItemIcon('heart', { size: NaN }).attributes.width, '32');
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});
