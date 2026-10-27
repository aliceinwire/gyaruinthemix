import { localizeText, localizeAttribute } from './localized-ui.js';
import { message } from './i18n.js';
import { NOTE_LEAD } from './club-rhythm.js';
const pads = {
  boost: ['↑ ハンズアップ', 'SPACE / ↑ · タップ', '飛ぶで', 'SPACE / ↑ 長押し'],
  charge: ['● ベース', 'E / C · タップ', '充電', 'E / C 充電所で'],
  rush: ['▼ ドロップ', 'X / SHIFT · タップ', 'テキーララッシュ', 'X / SHIFT 電池を使う'],
};
const symbols = { boost: '↑', charge: '●', rush: '▼' };
export function setClubControls(root, enabled) {
  localizeAttribute(root.querySelector('.controls'), 'aria-label', enabled ? 'DJセットの３つのパッド' : '運転中の３つの操作');
  for (const button of root.querySelectorAll('[data-control]')) {
    const [name, hint, roadName, roadHint] = pads[button.dataset.control];
    localizeText(button.querySelector('.control-name'), enabled ? name : roadName);
    localizeText(button.querySelector('small'), enabled ? hint : roadHint);
    localizeAttribute(button, 'data-suggestion', enabled ? 'タップ！' : 'いまココ');
    button.classList.remove('suggested');
  }
}
export function createClubRhythmUI(root = document) {
  const get = selector => root.querySelector(selector);
  const laneNodes = [...root.querySelectorAll('[data-rhythm-lane]')];
  const pools = laneNodes.map(lane => Array.from({ length: 8 }, () => {
    const note = root.createElement('i'); note.className = 'rhythm-note'; note.hidden = true;
    note.textContent = symbols[lane.dataset.rhythmLane]; lane.append(note); return note;
  }));
  let lastText = '';
  return {
    render(view, { complete = false, legacy = false } = {}) {
      const signature = JSON.stringify([view.ready, view.done, view.waiting, view.hits, view.total, view.combo,
        view.remaining, view.accuracy, view.countdown, view.feedback, view.cueSource, complete, legacy]);
      if (signature !== lastText) {
        lastText = signature;
        localizeText(get('#performance-title'), view.title);
        localizeText(get('#performance-tip'), 'ノーツがラインに重なったら、同じ列のボタンを1回タップ。長押しはせんでOK！');
        localizeText(get('#performance-score'), view.done ? message('{0}/{1} HIT · 精度 {2}%', [view.hits, view.total, view.accuracy]) : message('{0} HIT · {1} COMBO · あと {2}秒', [view.hits, view.combo, view.remaining]));
        localizeText(get('#performance-track'), view.done ? 'もう1セット遊ぶ' : 'DJセットで遊ぶ');
        get('#performance-track').hidden = !view.ready && !view.done;
        localizeText(get('#finale-home'), view.done ? (legacy ? 'タイトル戻ろか' : complete ? 'ランの記録を見る' : '次の街へ') : (legacy ? 'スキップしてタイトルへ' : complete ? 'スキップして記録を見る' : 'スキップして次の街へ'));
        localizeText(get('#rhythm-status'), view.ready ? '参加は自由。スキップしても記録はそのまま。' : view.done ? 'ナイスセット！' : view.waiting ? 'ラジオを再生したら、今の曲に合わせて続けよ。' : view.countdown ? message('あと {0}', [view.countdown]) : view.feedback || 'ラインでタップ');
        localizeText(get('#rhythm-source'), view.cueSource === 'audio' ? '音のアタックに合わせて' : 'フリーリズム / ノーツを目印に');
      }
      localizeText(get('#performance-phase'), view.phase);
      get('#performance-progress').style.width = `${view.progress * 100}%`;
      const mode = view.ready ? 'ready' : view.done ? 'done' : view.waiting ? 'waiting' : 'playing';
      get('#rhythm-board').dataset.state = mode;
      get('#performance-panel').dataset.state = mode;
      laneNodes.forEach((lane, index) => {
        const notes = view.notes.filter(note => note.action === lane.dataset.rhythmLane);
        const height = lane.clientHeight;
        pools[index].forEach((node, i) => {
          const note = notes[i]; node.hidden = !note;
          if (!note) return;
          node.dataset.result = note.status;
          node.style.transform = `translateY(${(1 - note.offset / NOTE_LEAD) * height * .76 - 9}px)`;
        });
      });
      for (const button of root.querySelectorAll('[data-control]')) {
        const due = view.playing && view.notes.some(note => note.status === 'pending' && note.action === button.dataset.control && Math.abs(note.offset) <= .14);
        button.classList.toggle('suggested', Boolean(due));
        button.disabled = view.ready || view.done || view.waiting;
      }
    },
  };
}
