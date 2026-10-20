import { resolveCharacterPose } from './character-actions.js';

const rows = (edges) => edges.slice(0, -1).map((top, row) =>
  [0, 314, 628, 942].map((left, column) => [left, top, column === 3 ? 312 : 314, edges[row + 1] - top]));
export const CABIN_SHEETS = Object.freeze({
  arisu: { url: new URL('../assets/characters/motion/arisu-cabin.png', import.meta.url).href, width: 1254, height: 1254,
    actions: ['drive', 'point', 'shocked', 'rally'], sourceRects: rows([20, 258, 493, 730, 963]) },
  chana: { url: new URL('../assets/characters/motion/chana-cabin.png', import.meta.url).href, width: 1254, height: 1254,
    actions: ['map', 'directions', 'makeup', 'cheer', 'hearts'], sourceRects: rows([0, 234, 453, 656, 854, 1053]) },
});
const rushUrl = new URL('../assets/characters/motion/crew-cabin-rush.png', import.meta.url).href;
export const CABIN_RUSH_SHEET = {url: rushUrl, width: 1774, height: 887};
const images = {};
let loading;
export function preloadCabinCharacters() {
  return loading ||= Promise.all(Object.entries({...CABIN_SHEETS, rush: CABIN_RUSH_SHEET}).map(([name, sheet]) => new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = ready => { if (settled) return; settled = true; clearTimeout(timer); image.onload = null; image.onerror = null; if (ready) images[name] = image; resolve(ready); };
    const timer = setTimeout(() => finish(false), 15000);
    image.onload = () => finish((image.naturalWidth || image.width) === sheet.width && (image.naturalHeight || image.height) === sheet.height);
    image.onerror = () => finish(false);
    image.src = sheet.url;
  }))).then(ready => { if (ready.some(item => !item)) { loading = null; throw new Error('Required cabin character art failed to load'); } return true; });
}

/** The same action/frame decision as portraits, projected into dedicated side-view art. */
export function drawCabinCharacter(ctx, options = {}) {
  const { name, localAction, frame, animationFrame } = resolveCharacterPose(options);
  const sheet = CABIN_SHEETS[name], image = images[localAction === 'rush' ? 'rush' : name];
  if (!image) return false;
  const row = Math.max(0, sheet.actions.indexOf(localAction));
  // Match semantic phases where the generated columns differ: blink, kiss contact, release.
  // A repeated contact frame keeps the hand at the lips until the shared release phase.
  const order = name === 'arisu' && localAction === 'drive' ? [0, 3, 1, 2] : name === 'chana' && localAction === 'hearts' ? [0, 0, 3, 2] : name === 'chana' && localAction === 'cheer' ? [0, 2, 3, 2] : [0, 1, 2, 3];
  const column = order[animationFrame];
  const [sx, sy, sw, sh] = localAction === 'rush' ? [animationFrame * 443, name === 'arisu' ? 0 : 446, 443, name === 'arisu' ? 438 : 441] : sheet.sourceRects[row][column];
  const { x = 0, y = 0, width = 40, height = 34, time = 0, animate = true } = options;
  const upbeat = ['cheer', 'point', 'hearts'].includes(localAction);
  const bob = animate ? Math.sin(time * (upbeat ? 8 : 4)) * height * (upbeat ? .018 : .007) : 0;
  const scale = localAction === "rush" ? Math.min(width / 560, height / 455) : Math.min(width / 314, height / 238);
  const dx = Math.round(x), dy = Math.round(y + height - sh * scale + bob);
  const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
  ctx.save();ctx.imageSmoothingEnabled = false;
  if (localAction === "rush" && name === "arisu" && animationFrame > 0) {
    // Isolate the preceding column's wheel shaft without trimming this frame's hair.
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.rect(dx, dy + 354 / sh * dh, 31 / sw * dw, 40 / sh * dh);
    ctx.clip("evenodd");
  }
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
  return { character: name, action: localAction, frame, animationFrame, ready: true };
}
