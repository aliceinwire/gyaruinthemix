/** Shared pixel artwork for equipment cards and the in-world loadout. */
const PALETTE = Object.freeze({
  k: '#171321', s: '#51445e', p: '#ff77bd', h: '#ffd0e7',
  m: '#8cf0db', t: '#389e98', g: '#ffda83', w: '#fff4e8', v: '#b69aff',
});
// Sixteen logical pixels keep the silhouettes crisp at both card and HUD sizes.
const ART = {
  phone: [
    '................', '..........kk....', '...kkkkkkkkk....', '..kppppppppk....',
    '..kphkkkkhpk....', '..kpkmmmmkpk....', '..kpkmwwmkpk....', '..kphkkkkhpk....',
    '...kkkkkkkk.....', '..kppphhpppk....', '..kpkpkpkppk....', '..kpkpkpkppk....',
    '..kppppppppk.k..', '...kkkkkkkk.kgk.', '.............k..', '................',
  ],
  md: [
    '................', '..kkkkkkkkkkkk..', '.kppppppppppppk.', '.kphhhhhhhhhppk.',
    '.kphwwwwwwwhppk.', '.kphwssssswhppk.', '.kphwwwwwwwhppk.', '.kphhhhhhhhhppk.',
    '.kppppppppppppk.', '.kpppkkkkkkpppk.', '.kppkswwwskpppk.', '.kppkswwsskpppk.',
    '.kppkssssskpppk.', '..kkkkkkkkkkkk..', '................', '................',
  ],
  album: [
    '................', '..kkkkkkkkkkkk..', '.kvvvvvvvvvvvvk.', '.kvwwwwwwwwwwvk.',
    '.kvwkppkkppkwvk.', '.kvwkppppppkwvk.', '.kvwwkppppkwwvk.', '.kvwwwkkkkwwwvk.',
    '.kvwwwwwwwwwwvk.', '.kvwssswwssswvk.', '.kvwwwwwwwwwwvk.', '.kvwsssssswwwvk.',
    '.kvwwwwwwwwwwvk.', '.kvvvvvvvvvvvvk.', '..kkkkkkkkkkkk..', '................',
  ],
  heart: [
    '................', '................', '..kkkk...kkkk...', '.kppppk.kppppk..',
    'kphhpppkppppppk.', 'kphhppppppppppk.', 'kpppppppppppppk.', '.kpppppppppppk..',
    '..kpppppppppk...', '...kpppppppk....', '....kpppppk.....', '.....kpppk......',
    '......kpk.......', '.......k........', '................', '................',
  ],
  camera: [
    '................', '................', '....kkkkkk......', '....kppppk......',
    '..kkkkkkkkkkkk..', '.kssssssssssssk.', '.kswwsskkkksspk.', '.ksssskmmtmkssk.',
    '.kssskmwwtmmksk.', '.kssskmwwtmmksk.', '.ksssskmmtmkssk.', '.kssssskkkksssk.',
    '..kkkkkkkkkkkk..', '................', '................', '................',
  ],
  vinyl: [
    '................', '.....kkkkkk.....', '...kksssssskk...', '..kssksssssssk..',
    '..kskssssssssk..', '.kssssspppssssk.', '.ksssspphppsssk.', '.kssspphkhppssk.',
    '.kssspphkhppssk.', '.ksssspphppsssk.', '.kssssspppssssk.', '..kssssssskssk..',
    '..kssssssskssk..', '...kksssssskk...', '.....kkkkkk.....', '................',
  ],
  bass: [
    '................', '....kkkkkkkk....', '....kppppppk....', '....kskkkkpk....',
    '.m..kksmmkkk..m.', '.mt.kksmmkkk.tm.', '.mt.kpkkkkpk.tm.', 'mmt.kppppppk.tmm',
    'mmt.kpkkkkpk.tmm', '.mt.kkmttmkk.tm.', '.mt.kkmwwmkk.tm.', '.m..kkmttmkk..m.',
    '....kpkkkkpk....', '....kppppppk....', '....kkkkkkkk....', '................',
  ],
  battery: [
    '................', '......kkkk......', '......kssk......', '....kkkkkkkk....',
    '...kmmmmmmmmk...', '...kmwmmmggmk...', '...kmwmmggmmk...', '...kmmmggmmmk...',
    '...kmmggggmmk...', '...kmmmggmmmk...', '...kmmggmmmmk...', '...kmmgmmmmmk...',
    '...kmmmmmmmmk...', '....kkkkkkkk....', '................', '................',
  ],
  feather: [
    '................', '..........kkkk..', '........kkwwmk..', '.......kwwwwmk..',
    '......kwwwwmk...', '.....kwwmwmk....', '....kwwmwmk.....', '....kwmwmk......',
    '...kwmwmk.......', '...kmwmk........', '...kmmk.........', '....mk..........',
    '...mk...........', '..mk............', '..k.............', '................',
  ],
  shield: [
    '................', '.......kk.......', '....kkkmmkkk....', '..kkmmmmmmmmkk..',
    '..kmwwmmmmmmmk..', '..kmwmmkkmmmmk..', '..kmmmkgpkmmmk..', '..kmmmkgpkmmmk..',
    '...kmmkgpkmmk...', '...kmmmkkmmmk...', '....kmmmmmmk....', '.....kmmmmk.....',
    '......kmmk......', '.......kk.......', '................', '................',
  ],
  star: [
    '................', '.......kk.......', '......kggk......', '......kgwk......',
    '.....kggwwk.....', '..kkkggggggkkk..', '.kggggggggggggk.', '..kggggggggggk..',
    '...kggggggggk...', '....kggggggk....', '...kggggggggk...', '...kgggkkgggk...',
    '..kggkk..kkggk..', '..kkk......kkk..', '................', '................',
  ],
  chain: [
    '................', '................', '..kkkkk.........', '.kmmmmmk........',
    '.kmkkkmk........', '.kmk.kmk........', '.kmk.kmkkkkk....', '.kmkkkmkppppk...',
    '..kkkkmkpkppk...', '......kmkkppk...', '......kppkppk...', '......kppkppk...',
    '......kpppppk...', '.......kkkkk....', '................', '................',
  ],
  bolt: [
    '................', '........kkkk....', '.......kggwk....', '......kggwk.....',
    '.....kggwk......', '....kggwk.......', '...kgggkkkkkk...', '...kggggggggk...',
    '....kkkkgggk....', '.......kggk.....', '......kggk......', '.....kggk.......',
    '....kggk........', '....kkk.........', '................', '................',
  ],
  repair: [
    '................', '...kk.....kk....', '..kmmk...kmmk...', '..kmmk...kmmk...',
    '..kmmmkkkmmmk...', '...kmmmmmmmk....', '....kkmmmkk.....', '.....kmmmk......',
    '.....kmmmk......', '.....kmmmk......', '.....kmmmk......', '.....kmwmk......',
    '.....kmwmk......', '......kkk.......', '................', '................',
  ],
  wheel: [
    '................', '.....kkkkkk.....', '...kksssssskk...', '..ksswwwwwwssk..',
    '..kswwswwswwsk..', '.kswwswsswswwsk.', '.kswswswwswswsk.', '.kswwswhhwswwsk.',
    '.kswwswhhwswwsk.', '.kswswswwswswsk.', '.kswwswsswswwsk.', '..kswwswwswwsk..',
    '..ksswwwwwwssk..', '...kksssssskk...', '.....kkkkkk.....', '................',
  ],
  paint: [
    '................', '.........kkk....', '........kpppk...', '.......kpppk....',
    '......kpppk.....', '.....kpppk......', '....kkppk.......', '...kwwkk........',
    '..kwwwk.........', '.kwwwk..........', '.kppk...........', '..kk.....kkk....',
    '........kpppk...', '........kpppk...', '.........kkk....', '................',
  ],
  leopard: [
    '................', '..kkkkkkkkkkkk..', '.kggggggggggggk.', '.kggkkggggkkggk.',
    '.kgkggkggkggkgk.', '.kgkggkgggkkggk.', '.kggkkggggggggk.', '.kggggggkkggggk.',
    '.kgggggkggkgggk.', '.kggkkgkggkgggk.', '.kgkggkgkkggggk.', '.kgkggkgggggkgk.',
    '.kggkkgggggkggk.', '.kggggggggggggk.', '..kkkkkkkkkkkk..', '................',
  ],
  flame: [
    '................', '.......k........', '......kpk.......', '.....kppk.......',
    '....kpppk.......', '....kppppk......', '...kppppppk.k...', '..kppppgpppkpk..',
    '..kpppggpppppk..', '..kppgggpppppk..', '..kppgwwgppppk..', '...kpgwwgpppk...',
    '....kggggppk....', '.....kkkkkk.....', '................', '................',
  ],
  car: [
    '................', '................', '................', '.....kkkkkk.....',
    '....kmmmmmmk....', '...kmmmmmmmmk...', '..kkkkkkkkkkkk..', '.kppppppppppppk.',
    '.khhpppppppphhk.', '.kppppppppppppk.', '..kkkkkkkkkkkk..', '..kssk....kssk..',
    '...kk......kk...', '................', '................', '................',
  ],
};
const definitions = new Map();
const define = (ids, art, accent, badge) => ids.forEach(id => definitions.set(id, { art, accent, badge }));
define(['heart', 'hearts'], 'heart');
define(['flash'], 'camera');
define(['vinyl'], 'vinyl');
define(['bass'], 'bass');
define(['phone'], 'phone');
define(['md', 'echo'], 'md');
define(['hotline'], 'phone', '#8cf0db', 'star');
define(['album'], 'album');
define(['battery'], 'battery');
define(['glide', 'air', 'air-control'], 'feather');
define(['armor', 'guardian', 'charge-shield', 'sanctuary'], 'shield');
define(['hype'], 'star');
define(['relay', 'chorus', 'heart-chain'], 'chain');
define(['charger', 'capacitor', 'charged-heart'], 'bolt');
define(['repair', 'comeback'], 'repair');
define(['heart-pierce', 'spotlight'], 'heart', undefined, 'bolt');
define(['recycle', 'heart-recycle', 'combo-flight', 'rebound'], 'battery', undefined, 'star');
define(['shield-piercing'], 'shield', undefined, 'bolt');
define(['drop', 'rush-pulse'], 'bass', undefined, 'bolt');
define(['rushCooler'], 'feather', '#b69aff', 'star');
define(['heartReach'], 'heart', undefined, 'star');
define(['evRange'], 'battery', undefined, 'chain');
define(['heartstorm'], 'heart', undefined, 'chain');
define(['flashmob'], 'camera', undefined, 'star');
define(['encore'], 'vinyl', undefined, 'star');
define(['afterparty'], 'bass', undefined, 'star');
const paints = { pink: '#ff77bd', mint: '#8cf0db', purple: '#b69aff', gold: '#ffda83', blue: '#72aeff', black: '#51445e' };
for (const [id, color] of Object.entries(paints)) define([`paint:${id}`], 'paint', color);
for (const [id, color] of Object.entries({ classic: '#fff4e8', heart: '#ff77bd', neon: '#8cf0db', gold: '#ffda83' }))
  define([`wheels:${id}`], 'wheel', color, id === 'heart' ? 'heart' : undefined);
define(['decal:none'], 'vinyl');
define(['decal:hearts'], 'heart');
define(['decal:stars'], 'star');
define(['decal:leopard'], 'leopard');
define(['decal:flames'], 'flame');
define(['mix-175'], 'car');
define(['spark-k'], 'car', '#8cf0db', 'bolt');
define(['rocket-gal'], 'car', '#b69aff', 'flame');
define(['bass-van'], 'car', '#ffda83', 'bass');
define(['heart-limo'], 'car', '#72aeff', 'heart');

export const ITEM_ICON_SIZE = 32;
export const ITEM_ICON_IDS = Object.freeze([...definitions.keys()]);
export const hasItemIcon = id => definitions.has(id);
const cache = new Map();
/** Immutable colored rectangles also make SVG and canvas use identical artwork. */
export function itemIconRects(id) {
  const key = hasItemIcon(id) ? id : 'hype';
  if (cache.has(key)) return cache.get(key);
  const { art, accent, badge } = definitions.get(key);
  const rectangles = [];
  function stamp(name, scale, offsetX = 0, offsetY = 0, recolor = false) {
    ART[name].forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const colorKey = row[x], start = x;
        while (x < row.length && row[x] === colorKey) x++;
        if (colorKey === '.') continue;
        const color = recolor && accent && (colorKey === 'p' || name === 'wheel' && colorKey === 'w') ? accent : PALETTE[colorKey];
        rectangles.push(Object.freeze({ x: offsetX + start * scale, y: offsetY + y * scale, width: (x - start) * scale, height: scale, color }));
      }
    });
  }
  stamp(art, 2, 0, 0, true);
  if (badge) stamp(badge, 1, 16, 16);
  const result = Object.freeze(rectangles);
  cache.set(key, result);
  return result;
}
const displaySize = size => Number.isFinite(size) && size > 0 ? Math.min(256, Math.max(12, Math.round(size))) : ITEM_ICON_SIZE;
/** Decorative: the adjacent translated equipment name supplies the accessible label. */
export function createItemIcon(id, { size = ITEM_ICON_SIZE } = {}) {
  const ns = 'http://www.w3.org/2000/svg', icon = document.createElementNS(ns, 'svg');
  icon.setAttribute('viewBox', `0 0 ${ITEM_ICON_SIZE} ${ITEM_ICON_SIZE}`);
  icon.setAttribute('width', displaySize(size));
  icon.setAttribute('height', displaySize(size));
  icon.setAttribute('class', 'item-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('shape-rendering', 'crispEdges');
  icon.setAttribute('data-item-icon', hasItemIcon(id) ? id : 'hype');
  for (const rectangle of itemIconRects(id)) {
    const pixel = document.createElementNS(ns, 'rect');
    for (const field of ['x', 'y', 'width', 'height']) pixel.setAttribute(field, rectangle[field]);
    pixel.setAttribute('fill', rectangle.color);
    icon.append(pixel);
  }
  return icon;
}
export function drawItemIcon(ctx, id, x, y, size = ITEM_ICON_SIZE) {
  const scale = displaySize(size) / ITEM_ICON_SIZE;
  ctx.save();
  for (const pixel of itemIconRects(id)) {
    ctx.fillStyle = pixel.color;
    ctx.fillRect(x + pixel.x * scale, y + pixel.y * scale, pixel.width * scale, pixel.height * scale);
  }
  ctx.restore();
}
