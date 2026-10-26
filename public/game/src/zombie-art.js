/** Zombie rivals and their own gyaru outfits share the street's detailed sprite style. */
export const ZOMBIE_SHEET = Object.freeze({
  url: new URL('../assets/characters/street/zombie-atlas.png', import.meta.url).href,
  width: 1536, height: 1024,
  poses: Object.freeze({
    shambler: Object.freeze([286, 11, 357, 492]),
    bouncer: Object.freeze([890, 4, 447, 499]),
    'silver-manba': Object.freeze([241, 501, 391, 512]),
    'purple-rokku': Object.freeze([898, 508, 406, 514]),
  }),
});
let atlas = null, loading = null;
export function preloadZombieCharacters() {
  if (atlas) return Promise.resolve(true);
  if (loading) return loading;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  loading = new Promise(resolve => {
    const image = new Image();
    const finish = ready => {
      clearTimeout(timer); image.onload = image.onerror = null;
      if (ready) atlas = image;
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 12000);
    image.onload = () => finish(image.naturalWidth === ZOMBIE_SHEET.width && image.naturalHeight === ZOMBIE_SHEET.height);
    image.onerror = () => finish(false);
    image.src = ZOMBIE_SHEET.url;
  }).then(ready => { if (!ready) loading = null; return ready; });
  return loading;
}

export function drawZombieCharacter(ctx, actor, x, y, time = 0) {
  if (!actor.zombie || !atlas) return false;
  const gyaru = actor.converted || actor.type === 'gyaru';
  const crop = ZOMBIE_SHEET.poses[gyaru ? actor.zombie.gyaruStyle : actor.zombie.id];
  if (!crop) return false;
  const heavy = actor.zombie.id === 'bouncer';
  const height = heavy && !gyaru ? 82 : 76;
  const width = Math.round(crop[2] / crop[3] * height);
  const bob = Math.round(Math.sin(time * (gyaru ? 7 : 3) + (Number(actor.id) || 0)) * (gyaru ? 2 : 1));
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, ...crop, Math.round(x - width / 2), Math.round(y - height + bob), width, height);
  const accent = heavy ? '#ad78ef' : '#74e4cf';
  if (gyaru) {
    ctx.fillStyle = accent;
    for (let i = 0; i < 3; i++) ctx.fillRect(Math.round(x - 23 + i * 23), Math.round(y - height - 4 + Math.sin(time * 5 + i) * 3), 2, 2);
  } else {
    const maximum = Math.min(12, Math.max(1, Math.ceil(actor.maxHp || actor.hp || 1)));
    for (let i = 0; i < maximum; i++) {
      ctx.fillStyle = i < Math.ceil(actor.hp || 0) ? accent : '#3c354c';
      ctx.fillRect(Math.round(x - maximum * 2.5 + i * 5), Math.round(y - height - 7), 4, 3);
    }
  }
  ctx.restore();
  return true;
}
