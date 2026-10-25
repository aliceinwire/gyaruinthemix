import { drawItemIcon, createItemIcon } from './item-icons.js';
import { t, message, number } from './i18n.js';
import { localizeText } from './localized-ui.js';
import { SILENT_MUSIC, weaponMusicLevel } from './music-reactivity.js';
import { isSurvival, survivalMultiplier, survivalResult, survivalRecordCategory, SURVIVAL_UPGRADES, SURVIVAL_EVOLUTIONS } from './survival.js';

export function renderSurvivalResult(state, result, previous, host) {
  const row = survivalResult(state);
  if (!row) return;
  const stat = (label, value) => {
    const item = document.createElement('div'), caption = document.createElement('span'), strong = document.createElement('strong');
    localizeText(caption, label); localizeText(strong, value); item.append(caption, strong); host.append(item);
  };
  host.replaceChildren(); host.classList.add('survival-results');
  const category = document.createElement('p'); category.className = 'survival-record-note';
  localizeText(category, survivalRecordCategory(row));
  host.append(category);
  stat('スコア', number(row.score, { useGrouping: true }));
  stat('生き抜いた時間', `${Math.floor(row.seconds / 60)}:${String(row.seconds % 60).padStart(2, '0')}`);
  stat('ノーダメージウェーブ', `${row.cleanWaves} / ${row.waves}`);
  stat('フロアへ招待', row.kills);
  if (result.eligible !== false) {
    const best = document.createElement('p'); best.className = 'survival-record-note';
    localizeText(best, result.best ? row.musicDriven ? 'ミュージックドライブ自己ベスト更新！' : row.assisted ? 'ゆったり自己ベスト更新！' : '今日の自己ベスト！' : message('今日の自己ベストまで、あと {0}', [number(Math.max(0, (previous?.score || row.score) - row.score), { useGrouping: true })]));
    host.append(best);
  }
  const build = document.createElement('p'); build.className = 'survival-build-recap';
  for (const item of SURVIVAL_UPGRADES.filter(item => row.build[item.id])) {
    const slot = document.createElement('span'), label = document.createElement('span'); slot.className = 'build-slot';
    localizeText(label, `${item.name} ${row.build[item.id]}/${item.maxLevel}`); slot.append(createItemIcon(item.id, { size: 24 }), label); build.append(slot);
  }
  const recordLabel = document.createElement('small'); recordLabel.className = 'survival-record-note';
  localizeText(recordLabel, result.eligible === false ? '引き継いだツアーのスコアや。今のデイリー記録には入らへん。' : result.persisted ? message('この端末の記録 · {0} · 日本時間', [row.day]) : '記録を保存できませんでした。このランはこの画面で確認できます。');
  host.append(build, recordLabel);
}

/** World-space pickups and restrained weapon feedback, independent of crew/car art. */
export function drawSurvival(ctx, state, time, reducedMotion = false, music = SILENT_MUSIC) {
  if (!isSurvival(state)) return;
  const s = state.survival;
  ctx.save();
  for (const gem of s.gems) {
    const x = 190 + (gem.distance - state.distance) * 3;
    if (x < -20 || x > 980) continue;
    const y = 392 + (reducedMotion ? 0 : Math.sin(time * 5 + gem.distance) * 4);
    ctx.fillStyle = gem.xp >= 20 ? '#ffe192' : '#8cffe7';
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill();
  }
  // The vinyl weapon has a visible orbit. Its damage still follows simulation timers.
  if (s.upgrades.vinyl) {
    const discs = s.evolutions.includes('encore') ? 4 : Math.min(3, s.upgrades.vinyl);
    for (let i = 0; i < discs; i++) {
      const angle = (reducedMotion ? 0 : time * 3) + i * Math.PI * 2 / discs;
      const x = 190 + Math.cos(angle) * 105, y = 410 - state.altitude * .85 + Math.sin(angle) * 22;
      ctx.fillStyle = '#161324'; ctx.strokeStyle = '#c5a6ff'; ctx.lineWidth = 2 + weaponMusicLevel('vinyl', music, reducedMotion);
      ctx.beginPath(); ctx.ellipse(x, y, 13, 7, -.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff79be'; ctx.beginPath(); ctx.ellipse(x, y, 4, 2, -.3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#141022df'; ctx.strokeStyle = s.fever > 0 ? '#ffdc91' : '#73567c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(22, 22, 316, 112, 10); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffafd9'; ctx.font = '700 11px system-ui';
  ctx.fillText(`${t(s.musicDriven ? survivalRecordCategory(s) : 'NIGHTFALL TOUR')}  /  ${t(message('ウェーブ {0} / 72', [state.routeIndex * 6 + s.wave + 1]))}`, 36, 43, 284);
  ctx.font = '800 28px system-ui'; ctx.fillStyle = '#fff5f9';
  ctx.fillText(t(number(Math.floor(state.score), { useGrouping: true })), 36, 76, 212);
  ctx.textAlign = 'right'; ctx.fillStyle = s.fever > 0 ? '#ffe192' : '#88ffe1'; ctx.font = '800 23px system-ui';
  ctx.fillText(`×${survivalMultiplier(state)}`, 322, 76);
  ctx.fillStyle = '#33253e'; ctx.fillRect(36, 89, 212, 7);
  ctx.fillStyle = s.fever > 0 ? '#ffe192' : '#ff79be'; ctx.fillRect(36, 89, 212 * (s.fever > 0 ? s.fever / (6 + (s.upgrades.hype || 0)) : s.heat / 100), 7);
  ctx.font = '700 10px system-ui'; ctx.fillText(s.fever > 0 ? 'FEVER' : 'HEAT', 322, 96);
  const equipped = SURVIVAL_UPGRADES.filter(item => item.kind === 'weapon' && s.upgrades[item.id]);
  equipped.forEach((item, index) => {
    const x = 36 + index * 41; drawItemIcon(ctx, item.id, x, 103, 24);
    ctx.font = '700 10px system-ui'; ctx.fillStyle = '#fff0f8'; ctx.textAlign = 'left'; ctx.fillText(String(s.upgrades[item.id]), x + 27, 121);
  });
  if (s.evolutions.length) {
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffe192'; ctx.font = '700 12px system-ui';
    ctx.fillText(s.evolutions.map(id => t(SURVIVAL_EVOLUTIONS.find(item => item.id === id).name)).join(' / '), 36, 146, 650);
  }
  ctx.restore();
}
