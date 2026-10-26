import { t } from './i18n.js';
import { suitStyleFor } from './street-culture.js';
/** Small code-native pixel props extend the original detailed sprite artwork. */
function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), width, height);
}
function label(ctx, value, x, y, color = '#fff0dc') {
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color;
  ctx.fillText(t(value), Math.round(x), Math.round(y), 80);
}
const ink = '#242333', paper = '#eee5d8', pink = '#ff8bc8', mint = '#a2f4d9';
function camera(ctx, x, y) {
  rect(ctx,x-12,y-8,24,16,ink); rect(ctx,x-8,y-12,9,5,pink);
  rect(ctx,x-4,y-5,10,10,mint); rect(ctx,x-1,y-2,4,4,ink);
  rect(ctx,x+8,y-5,2,3,paper);
}

function polygon(ctx, x, y, points, color) {
  ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const [dx, dy] = points[i];
    if (i) ctx.lineTo(Math.round(x + dx), Math.round(y + dy));
    else ctx.moveTo(Math.round(x + dx), Math.round(y + dy));
  }
  ctx.closePath(); ctx.fill();
}

/** Tailored pixel layers sit on the atlas torso, leaving the face and stride intact. */
export function drawSuitUniform(ctx, actor, x, y) {
  const suit = suitStyleFor(actor);
  if (!suit || suit.cut === 'classic') return false;
  const shoulder = 12 + suit.width, hem = suit.cut === 'coat' ? -24 : -32;
  ctx.save();
  // Stronger guards and chiefs have broader shoulders and longer, heavier jackets.
  polygon(ctx,x,y,[[-7,-51],[-shoulder,-48],[-shoulder-4,-35],[-shoulder+1,-33],[-9,-43],[-10,hem],[-1,hem-1],[3,-39],[8,hem],[13,hem-2],[9,-50]],ink);
  polygon(ctx,x,y,[[-7,-49],[-shoulder+1,-47],[-shoulder-2,-36],[-shoulder,-35],[-8,-45],[-8,hem-2],[-2,hem-3],[3,-42],[9,hem-2],[11,hem-3],[8,-49]],suit.jacket);
  // White collar, contrasting lapels and a small tie retain the suit silhouette.
  polygon(ctx,x,y,[[-5,-50],[7,-50],[5,-43],[2,-36],[-1,-44]],paper);
  polygon(ctx,x,y,[[-7,-50],[-2,-45],[-4,-43],[1,-36],[-7,-42]],suit.light);
  polygon(ctx,x,y,[[8,-50],[5,-44],[8,-42],[3,-36],[9,-43]],suit.light);
  rect(ctx,x+1,y-49,3,3,suit.tie);
  polygon(ctx,x,y,[[2,-46],[4,-46],[5,-38],[3,-36],[1,-38]],suit.tie);
  if (suit.cut === 'vest' || suit.cut === 'rolled') {
    rect(ctx,x-6,y-44,4,9,suit.light); rect(ctx,x+7,y-44,3,9,suit.light);
    for (let i=0;i<3;i++) rect(ctx,x+2,y-42+i*3,1,1,paper);
    if (suit.cut === 'rolled') rect(ctx,x-shoulder-1,y-38,6,3,paper);
  } else if (suit.cut === 'pinstripe') {
    for (let i=0;i<3;i++) rect(ctx,x-10+i*4,y-42,1,7,suit.light);
    rect(ctx,x+9,y-41,1,6,suit.light);
  } else if (suit.cut === 'double' || suit.cut === 'coat') {
    for (let i=0;i<2;i++) {
      rect(ctx,x-4,y-38+i*4,2,2,suit.tie); rect(ctx,x+5,y-38+i*4,2,2,suit.tie);
    }
    rect(ctx,x-shoulder+2,y-47,6,2,suit.light);
    rect(ctx,x+7,y-46,5,2,paper);
  }
  if (suit.glasses) {
    rect(ctx,x,y-62,7,4,ink); rect(ctx,x+9,y-62,6,4,ink);
    rect(ctx,x+6,y-61,4,1,ink);
    rect(ctx,x+1,y-61,4,2,suit.light); rect(ctx,x+10,y-61,3,2,suit.light);
  }
  if (suit.silverHair) {
    rect(ctx,x-8,y-69,3,7,'#aaa8b7'); rect(ctx,x-7,y-71,4,2,'#d6d0d7');
    rect(ctx,x-4,y-73,7,2,'#aaa8b7');
  }
  ctx.restore(); return true;
}

export function drawCultureProp(ctx, actor, x, y, time = 0) {
  const role = actor.streetRole;
  if (!role || role.id === 'salaryman' && !actor.converted) return;
  ctx.save();
  if (actor.converted) {
    const fan = role.fan;
    // Each new gyaru brings a creative kit to the club crowd.
    rect(ctx,x-18,y-43,5,4,pink); rect(ctx,x+13,y-43,5,4,mint);
    if (fan === 'photographer') camera(ctx,x+21,y-46);
    else if (fan === 'tv') {
      rect(ctx,x+20,y-44,4,21,ink); rect(ctx,x+15,y-52,14,10,pink);
      label(ctx,'ON AIR',x,y-88,mint);
    } else if (fan === 'event') {
      rect(ctx,x+18,y-69,3,58,paper); rect(ctx,x+21,y-68,27,19,pink);
      rect(ctx,x+25,y-64,17,3,mint); rect(ctx,x+25,y-58,11,3,paper);
      label(ctx,'LIVE',x,y-88,mint);
    } else if (fan === 'dj') {
      rect(ctx,x-21,y-72,42,5,pink); rect(ctx,x-25,y-68,7,15,ink); rect(ctx,x+18,y-68,7,15,ink);
      rect(ctx,x-24,y-66,4,10,mint); rect(ctx,x+20,y-66,4,10,mint);
    } else if (fan === 'stylist') {
      rect(ctx,x+22,y-58,3,10,mint); rect(ctx,x+17,y-59,8,3,mint);
      rect(ctx,x+13,y-48,21,3,pink); rect(ctx,x+8,y-45,31,3,pink);
      label(ctx,'STYLING',x,y-88,pink);
    } else {
      rect(ctx,x-26,y-48,14,4,mint); rect(ctx,x+13,y-48,14,4,mint);
      rect(ctx,x-17,y-64,13,4,pink); rect(ctx,x+3,y-64,13,4,pink);
      label(ctx,'MY STYLE',x,y-88,pink);
    }
  } else if (role.id === 'brand-rep') {
    rect(ctx,x+13,y-60,3,56,ink); rect(ctx,x+1,y-76,35,23,'#716581'); label(ctx,'BUY',x+18,y-61);
  } else if (role.id === 'copy-clerk') {
    for(let i=0;i<3;i++) { rect(ctx,x+10+i*3,y-52+i*5,19,24,ink); rect(ctx,x+12+i*3,y-50+i*5,15,18,paper); }
  } else if (role.id === 'deadline-runner') {
    rect(ctx,x+12,y-60,24,25,ink); rect(ctx,x+15,y-57,18,19,'#ffe0a1'); label(ctx,'00',x+24,y-44,ink);
  } else if (role.id === 'approval-chief') {
    rect(ctx,x+16,y-55,10,16,'#bc7e86'); rect(ctx,x+11,y-40,22,7,ink); label(ctx,'WAIT',x,y-87);
  } else if (role.id === 'notification-clerk') {
    rect(ctx,x+10,y-63,22,35,ink); rect(ctx,x+13,y-59,16,25,'#a7a4b6');
    for (let i=0;i<3;i++) { rect(ctx,x+15,y-56+i*7,12,4,paper); rect(ctx,x+24,y-57+i*7,4,4,'#cf697b'); }
    rect(ctx,x+18,y-31,6,1,paper);
  } else if (role.id === 'metrics-inspector') {
    rect(ctx,x+8,y-59,30,32,ink); rect(ctx,x+11,y-56,24,26,paper);
    for (let i=0;i<3;i++) rect(ctx,x+14+i*7,y-36-i*6,4,4+i*6,'#79758a');
    rect(ctx,x+17,y-64,13,5,'#aaa4b7');
  } else if (role.id === 'dress-code-guard') {
    rect(ctx,x+14,y-60,23,30,ink); rect(ctx,x+17,y-57,17,24,paper);
    rect(ctx,x+23,y-54,5,5,'#62556e'); rect(ctx,x+24,y-48,3,10,'#62556e');
    rect(ctx,x+12,y-34,27,4,'#bd6e83');
  } else if (role.id === 'overtime-runner') {
    rect(ctx,x+11,y-52,28,24,ink); rect(ctx,x+18,y-57,14,6,'#827b8f');
    rect(ctx,x+17,y-47,17,14,paper); rect(ctx,x+24,y-45,2,7,ink); rect(ctx,x+25,y-40,5,2,ink);
    rect(ctx,x+13,y-29,24,4,'#bd6e83');
  } else if (role.id === 'script-reader') {
    rect(ctx,x+12,y-58,26,30,ink); rect(ctx,x+15,y-55,20,24,paper);
    for (let i=0;i<4;i++) rect(ctx,x+18,y-51+i*5,14,2,'#827b8f');
    rect(ctx,x-20,y-51,4,15,ink); rect(ctx,x-24,y-57,12,8,'#a5a0b0');
  } else if (role.id === 'hierarchy-keeper') {
    for (let i=0;i<3;i++) { rect(ctx,x+13+i*3,y-62+i*10,26-i*6,8,ink); rect(ctx,x+16+i*3,y-60+i*10,20-i*6,4,'#b2a3bd'); }
    rect(ctx,x+23,y-32,3,8,ink); label(ctx,'WAIT',x,y-87);
  } else {
    rect(ctx,x+9,y-52,27,29,ink); rect(ctx,x+12,y-49,21,23,paper); label(ctx,'...',x+23,y-34,ink);
  }
  ctx.restore();
}
export function drawRoutineHazard(ctx, actor, x, y, time = 0) {
  const hazard = actor.routineHazard;
  if (!hazard) return false;
  ctx.save();
  if (hazard.id === 'roadworks') {
    rect(ctx,x-29,y-48,6,48,ink); rect(ctx,x+23,y-48,6,48,ink);
    rect(ctx,x-34,y-48,68,15,'#ffce68'); rect(ctx,x-34,y-24,68,12,'#ffce68');
    for (let i=0;i<5;i++) { rect(ctx,x-29+i*13,y-48,6,15,ink); rect(ctx,x-29+i*13,y-24,6,12,ink); }
    rect(ctx,x-27,y-58,6,8,'#ff8065'); rect(ctx,x+21,y-58,6,8,'#ff8065');
  } else if (hazard.id === 'broken-asphalt') {
    polygon(ctx,x,y,[[-46,-5],[-31,-11],[-17,-7],[-3,-13],[15,-7],[32,-10],[46,-4],[28,3],[-22,3]],ink);
    for (const [dx,dy] of [[-40,-9],[-18,-12],[13,-12],[33,-9]]) rect(ctx,x+dx,y+dy,10,5,'#88829b');
    rect(ctx,x-31,y-3,60,3,'#080b17');
    rect(ctx,x-50,y-17,7,13,'#ffce68'); rect(ctx,x+43,y-17,7,13,'#ffce68');
  } else if (hazard.id === 'speaker-crates') {
    for (const [dx,dy,w] of [[-31,-31,62],[-24,-57,48],[-17,-80,34]]) {
      rect(ctx,x+dx,y+dy,w,25,ink); rect(ctx,x+dx+3,y+dy+3,w-6,19,'#605774');
      rect(ctx,x+dx+5,y+dy+8,4,9,paper); rect(ctx,x+dx+w-9,y+dy+8,4,9,paper);
      rect(ctx,x+dx+w/2-5,y+dy+9,10,4,ink);
    }
  } else if (hazard.id === 'paper-stack') {
    for(let i=0;i<5;i++) { rect(ctx,x-22+(i%2)*4,y-5-i*6,42,6,ink); rect(ctx,x-20+(i%2)*4,y-5-i*6,38,4,paper); }
  } else if (hazard.id === 'deadline-clock') {
    rect(ctx,x-21,y-47,42,44,ink); rect(ctx,x-17,y-43,34,32,'#ffe1a6');
    label(ctx,'DUE',x,y-28,ink); label(ctx,String(3-Math.floor(time)%3).padStart(2,'0'),x,y-15,ink);
    rect(ctx,x-26,y-50,13,5,pink); rect(ctx,x+13,y-50,13,5,pink);
  } else if (hazard.id === 'ad-totem') {
    rect(ctx,x-8,y-26,16,26,ink); rect(ctx,x-33,y-86,66,64,ink);
    rect(ctx,x-29,y-82,58,55,'#72677c'); label(ctx,'MEGA',x,y-65); label(ctx,'CORP',x,y-50); label(ctx,'BUY MORE',x,y-35,'#ffe1a6');
  } else if (hazard.id === 'meeting-wall') {
    rect(ctx,x-28,y-67,4,67,ink); rect(ctx,x+24,y-67,4,67,ink);
    rect(ctx,x-35,y-68,70,49,ink); rect(ctx,x-31,y-64,62,41,paper);
    label(ctx,'MEETING',x,y-49,ink); label(ctx,'AGAIN?',x,y-33,'#a35e89');
  } else if (hazard.id === 'copy-printer') {
    rect(ctx,x-29,y-44,58,40,ink); rect(ctx,x-25,y-40,50,23,'#aaabb7');
    rect(ctx,x-19,y-57,38,16,paper); rect(ctx,x-18,y-25,36,9,ink);
    rect(ctx,x-14,y-22,28,20,paper); rect(ctx,x+17,y-36,5,5,pink);
    label(ctx,'COPY',x,y-29,ink);
  } else if (hazard.id === 'inbox-pile') {
    for (let i=0;i<3;i++) {
      const left=x-23+i*4, top=y-17-i*10;
      rect(ctx,left,top,39,17,ink); rect(ctx,left+2,top+2,35,13,paper);
      rect(ctx,left+7,top+4,5,3,'#aaa0af'); rect(ctx,left+12,top+7,13,3,'#aaa0af'); rect(ctx,left+25,top+4,5,3,'#aaa0af');
    }
  } else if (hazard.id === 'notification-tower') {
    rect(ctx,x-6,y-22,12,22,ink); rect(ctx,x-29,y-85,58,66,ink);
    rect(ctx,x-25,y-81,50,58,'#746c81');
    for (let i=0;i<3;i++) {
      rect(ctx,x-20,y-75+i*17,40,12,paper); rect(ctx,x-15,y-71+i*17,24,3,'#9b8b9f');
      rect(ctx,x+13,y-76+i*17,9,9,'#ca6d86');
    }
  } else if (hazard.id === 'metrics-gate') {
    rect(ctx,x-31,y-71,8,71,ink); rect(ctx,x+23,y-71,8,71,ink);
    rect(ctx,x-35,y-77,70,47,ink); rect(ctx,x-31,y-73,62,39,paper);
    for (let i=0;i<5;i++) rect(ctx,x-25+i*11,y-42-i*5,7,8+i*5,'#817389');
    rect(ctx,x-23,y-24,46,6,'#b86a84'); rect(ctx,x-23,y-13,46,6,'#b86a84');
  } else if (hazard.id === 'approval-queue') {
    rect(ctx,x-48,y-8,96,9,ink); rect(ctx,x-43,y-8,86,3,'#827180');
    for (let i=0;i<4;i++) {
      rect(ctx,x-37+i*21,y-24,15,12,paper); rect(ctx,x-33+i*21,y-21,7,6,'#bc7e86');
      rect(ctx,x-32+i*21,y-6,6,3,'#ffe1a6');
    }
  } else {
    rect(ctx,x-48,y-8,96,9,ink); rect(ctx,x-43,y-8,86,3,'#827180');
    for(let i=0;i<5;i++) rect(ctx,x-38+i*17,y-6,9,3,'#ffe1a6');
    label(ctx,'REPEAT',x,y-14,'#ffe1a6');
  }
  ctx.restore(); return true;
}
export function drawLittleFind(ctx, actor, x, y, time = 0) {
  if (actor.type !== 'little-find') return false;
  ctx.save();
  const bob = Math.round(Math.sin(time * 3) * 2), top = y-48+bob;
  rect(ctx,x-17,top-4,34,35,ink); rect(ctx,x-14,top-1,28,29,paper);
  if (actor.find.id === 'mini-photo') camera(ctx,x,top+13);
  else if (actor.find.id === 'flower') {
    rect(ctx,x-1,top+12,3,12,'#559779'); rect(ctx,x-8,top+4,16,12,pink); rect(ctx,x-4,top,8,20,pink); rect(ctx,x-3,top+7,6,6,'#ffe1a6');
  } else if (actor.find.id === 'paw-sticker') {
    rect(ctx,x-5,top+12,11,9,pink); for(const [dx,dy] of [[-9,6],[-3,2],[4,3],[9,8]]) rect(ctx,x+dx,top+dy,5,6,pink);
  } else if (actor.find.id === 'deco-charm') {
    rect(ctx,x-4,top+1,9,3,ink); rect(ctx,x-6,top+4,3,8,ink); rect(ctx,x+3,top+4,3,8,ink);
    rect(ctx,x-4,top+12,9,3,ink); rect(ctx,x-2,top+15,5,4,mint);
    rect(ctx,x-6,top+19,13,5,pink); rect(ctx,x-3,top+16,7,11,pink); rect(ctx,x-2,top+18,3,3,paper);
  } else if (actor.find.id === 'puri-note') {
    rect(ctx,x-11,top+3,22,15,'#b69aff');
    rect(ctx,x-8,top+5,6,7,'#ffe1a6'); rect(ctx,x+2,top+5,6,7,'#ffe1a6');
    rect(ctx,x-9,top+12,8,5,pink); rect(ctx,x+1,top+12,8,5,mint);
    rect(ctx,x-10,top+21,13,2,ink); rect(ctx,x-10,top+25,20,2,ink);
  } else {
    rect(ctx,x-3,top+2,6,22,'#e3a14a'); rect(ctx,x-10,top+9,20,7,'#e3a14a'); rect(ctx,x-2,top+8,5,8,'#fff0a2');
  }
  ctx.restore(); return true;
}
export function drawFriendlyCat(ctx, x, y, time = 0) {
  ctx.save();
  const fur = '#e8bf91';
  // On the pavement behind the EV. No target, hitbox, chase or damage state.
  rect(ctx,x+40,y-17,22,13,fur); rect(ctx,x+38,y-25,15,14,fur);
  rect(ctx,x+38,y-30,5,8,fur); rect(ctx,x+48,y-30,5,8,fur);
  rect(ctx,x+41,y-21,2,2,ink); rect(ctx,x+48,y-21,2,2,ink);
  rect(ctx,x+60,y-18,10,4,fur); rect(ctx,x+68,y-22+Math.round(Math.sin(time*2)),4,7,fur);
  ctx.restore();
}
