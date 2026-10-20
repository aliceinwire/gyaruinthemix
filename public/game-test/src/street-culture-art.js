import { t } from './i18n.js';
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
export function drawCultureProp(ctx, actor, x, y, time = 0) {
  const role = actor.streetRole;
  if (!role || role.id === 'salaryman' && !actor.converted) return;
  ctx.save();
  if (actor.converted) {
    const fan = role.fan;
    if (fan === 'photographer') camera(ctx,x+21,y-46);
    else if (fan === 'tv' || fan === 'event') {
      rect(ctx,x+20,y-44,4,21,ink); rect(ctx,x+15,y-52,14,10,pink);
      label(ctx,fan === 'tv' ? 'ON AIR' : 'LIVE',x,y-88,mint);
    } else if (fan === 'dj') {
      rect(ctx,x-21,y-72,42,5,pink); rect(ctx,x-25,y-68,7,15,ink); rect(ctx,x+18,y-68,7,15,ink);
    } else {
      rect(ctx,x-26,y-48,14,4,mint); rect(ctx,x+13,y-48,14,4,mint);
      label(ctx,fan === 'model' ? 'MY STYLE' : 'STYLING',x,y-88,pink);
    }
  } else if (role.id === 'brand-rep') {
    rect(ctx,x+13,y-60,3,56,ink); rect(ctx,x+1,y-76,35,23,'#716581'); label(ctx,'BUY',x+18,y-61);
  } else if (role.id === 'copy-clerk') {
    for(let i=0;i<3;i++) { rect(ctx,x+10+i*3,y-52+i*5,19,24,ink); rect(ctx,x+12+i*3,y-50+i*5,15,18,paper); }
  } else if (role.id === 'deadline-runner') {
    rect(ctx,x+12,y-60,24,25,ink); rect(ctx,x+15,y-57,18,19,'#ffe0a1'); label(ctx,'00',x+24,y-44,ink);
  } else if (role.id === 'approval-chief') {
    rect(ctx,x+16,y-55,10,16,'#bc7e86'); rect(ctx,x+11,y-40,22,7,ink); label(ctx,'WAIT',x,y-87);
  } else {
    rect(ctx,x+9,y-52,27,29,ink); rect(ctx,x+12,y-49,21,23,paper); label(ctx,'...',x+23,y-34,ink);
  }
  ctx.restore();
}
export function drawRoutineHazard(ctx, actor, x, y, time = 0) {
  const hazard = actor.routineHazard;
  if (!hazard) return false;
  ctx.save();
  if (hazard.id === 'paper-stack') {
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
