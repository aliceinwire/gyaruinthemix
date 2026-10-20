/** The people won over during the tour welcome the crew at the final club. */
import { JOURNEY_STAGE_COUNT } from './journey.js';

export const ARRIVAL_FAN_LIMIT = 40;
const pictures = {};
let loading;
const safe = n => Number.isFinite(n) ? Math.max(0, n) : 0;

export function getArrivalSupporters(state = {}) {
  const length = safe(state.routeLength), distance = safe(state.distance);
  const fans = Math.floor(safe(state.totalFans));
  if (state.routeIndex !== JOURNEY_STAGE_COUNT - 1 || !length || !fans || distance < length * .78) return [];
  const count = Math.min(ARRIVAL_FAN_LIMIT, fans);
  const start = length - Math.min(length * .3, Math.max(length * .12, count * 18)), end = length - 4;
  return Array.from({ length: count }, (_, i) => {
    const world = start + (count === 1 ? .5 : i / (count - 1)) * (end - start);
    return { id: i, x: 190 + (world - distance) * 3, y: 340 + (i % 3) * 2,
      kind: i % 6, phase: i * 2.399, world, representedFans: Math.floor(fans / count) + (i < fans % count ? 1 : 0) };
  }).filter(fan => fan.x > -75 && fan.x < 1035);
}

export function preloadArrivalFans() {
  if (loading) return loading;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  loading = Promise.all(Object.entries({
    street: 'characters/street/street-npc-atlas.png', arisu: 'characters/arisu-atlas.png',
    chana: 'characters/chana-atlas.png', logo: 'brand/gyaruinthemix-logo.png',
  }).map(([name, path]) => new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => finish(false), 12000);
    const finish = ok => { clearTimeout(timer); image.onload = image.onerror = null; if (ok) pictures[name] = image; resolve(ok); };
    image.onload = () => finish(true); image.onerror = () => finish(false);
    image.src = new URL('../assets/' + path, import.meta.url).href;
  }))).then(values => { const ready = values.every(Boolean); if (!ready) loading = null; return ready; });
  return loading;
}

function line(g, points, color, width) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); points.forEach(([x,y],i) => i ? g.lineTo(x,y) : g.moveTo(x,y)); g.stroke();
}
function box(g,x,y,w,h,color) { g.fillStyle=color; g.fillRect(Math.round(x),Math.round(y),w,h); }
function photo(g,x,y,w,h,pair=false) {
  box(g,x-2,y-2,w+4,h+4,'#fff1e9'); box(g,x,y,w,h,'#40243e');
  if (pictures.arisu) g.drawImage(pictures.arisu,0,0,192,208,x,y,w*(pair?.53:1),h);
  if (pair && pictures.chana) g.drawImage(pictures.chana,0,0,192,208,x+w*.47,y,w*.53,h);
}
function merch(g,kind,x,y,time,phase) {
  if (kind === 0 || kind === 3) {
    // Printed boards are held at the lower corners; faces and logo remain readable.
    photo(g,x-26,y-21,52,28,true);
    box(g,x-28,y+6,56,12,'#21182f');
    if(pictures.logo) g.drawImage(pictures.logo,x-25,y+5,50,15);
    box(g,x-26,y+15,52,2,'#f6a2d2');
  } else if(kind === 1 || kind === 4) {
    photo(g,x-9,y-18,18,22,kind===4);
    box(g,x-10,y+4,20,4,'#fcdfef');
  } else {
    const swing = Math.sin(time*5+phase)*3;
    g.strokeStyle='#f9dfa1';g.lineWidth=1.5;g.beginPath();g.arc(x,y+3,3,0,Math.PI*2);g.stroke();
    line(g,[[x,y+6],[x+swing,y+13]],'#e6d4b1',1.4);
    // Acrylic photo keychain, luminous edge and small printed portrait.
    box(g,x-7+swing,y+12,14,19,'#86f4e8');photo(g,x-5+swing,y+14,10,14,false);
  }
}
function supporter(g,fan,time,carX) {
  const {x,y,kind,phase}=fan;
  const body = ['#f759a6','#a692e5','#385a80','#f1d38c','#83cbbc','#e88a7d'][kind];
  const skin = ['#efb080','#ffd3ab','#b77b58'][fan.id%3];
  const head = fan.id%3;
  const bob = Math.sin(time*5.5+phase)*1.4;
  const shoulderY=y-31+bob;
  g.save();g.translate(Math.round(x),Math.round(y));
  // Shoes and clothes, not floating torsos or disconnected arm overlays.
  line(g,[[-6,-17],[-7,-3]],'#26253b',7);line(g,[[6,-17],[8,-3]],'#26253b',7);
  line(g,[[-8,-2],[-3,-2]],'#f5e9e5',4);line(g,[[7,-2],[12,-2]],'#f5e9e5',4);
  box(g,-11,-35+bob,22,20,body);box(g,-8,-33+bob,2,13,'#ffffff47');box(g,7,-33+bob,2,13,'#17182b49');
  box(g,-10,-17,20,3,'#242036');box(g,0,-17,3,3,'#eed498');
  g.restore();
  const board=kind===0||kind===3;
  const direction=carX<x?-1:1;
  const raisedX=x+direction*(22+Math.sin(time*6+phase)*4), raisedY=shoulderY-20+Math.cos(time*6+phase)*3;
  const hand1=board ? [x-26,shoulderY+17] : [raisedX,raisedY];
  const hand2=board ? [x+26,shoulderY+17] : [x-direction*17,shoulderY-8];
  for(const [side,hand] of [[board ? -1 : direction,hand1],[board ? 1 : -direction,hand2]]) {
    const start=[x+side*9,shoulderY], elbow=[x+side*17,shoulderY+3];
    line(g,[start,elbow,hand],'#211b32',7);line(g,[start,elbow],body,5);
    line(g,[elbow,hand],skin,4);g.fillStyle=skin;g.beginPath();g.arc(hand[0],hand[1],3,0,Math.PI*2);g.fill();
  }
  // Detailed source heads retain the established street-character art direction.
  if(pictures.street) {
    const crops=[[231,17,180,176],[657,8,235,204],[1140,38,210,168]];
    const [sx,sy,sw,sh]=crops[head];
    g.drawImage(pictures.street,sx,sy,sw,sh,x-16,y-62+bob,32,30);
  }
  if(board) {
    merch(g,kind,x,shoulderY+12,time,phase);
    // Fingers overlap the board edge so the object visibly belongs to its holder.
    box(g,x-28,shoulderY+15,5,6,skin);box(g,x+23,shoulderY+15,5,6,skin);
  } else {
    merch(g,kind,hand2[0],hand2[1]-2,time,phase);
    line(g,[[hand1[0]-1,hand1[1]],[hand1[0]-3,hand1[1]-5]],skin,2);
    line(g,[[hand1[0]+1,hand1[1]],[hand1[0]+2,hand1[1]-6]],skin,2);
  }
}

/** Decoration only: no entities, rewards or collision boxes are created. */
export function drawArrivalFans(ctx,state,{time=0,reducedMotion=false,carX=190}={}) {
  const fans=getArrivalSupporters(state);
  if(!fans.length || !pictures.street) return 0;
  const t=reducedMotion?0:safe(time);
  ctx.save();ctx.imageSmoothingEnabled=false;
  for(const fan of fans) supporter(ctx,fan,t,carX);
  ctx.restore();return fans.length;
}
