import { localizeText } from './localized-ui.js';
import { message } from './i18n.js';
import { getStoryScene, normalizeStoryMemory, storyMemoryForRun, markStorySeen, chooseStoryOption, getStoryJournal, STORY_SPEAKERS } from './tour-story.js';

export const STORY_SAVE_KEY = 'gyaruinthemix-tour-story-v2';

/** Narrative owns its text and reading pace; the host owns simulation transitions. */
export function createStoryDirector({ root = document, storage, getState, onOpen, onSaveError = () => {} }) {
  const $ = selector => root.querySelector(selector);
  let memory;
  try { memory = normalizeStoryMemory(storage?.getItem(STORY_SAVE_KEY)); }
  catch { memory = normalizeStoryMemory(); }
  let scene = null, line = 0, complete = null, journal = false;
  const panel = $('#story-panel');
  function persist() {
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(STORY_SAVE_KEY, JSON.stringify(memory));
    } catch { onSaveError(); }
  }
  function finish() {
    if (!scene) return;
    if (!journal) { memory = markStorySeen(memory, scene.id); persist(); }
    scene = null;
    const callback = complete;
    complete = null;
    callback?.();
  }
  function render() {
    if (!scene) return;
    const current = scene.lines[line];
    localizeText($('#story-kicker'), scene.kicker);
    localizeText($('#story-speaker'), STORY_SPEAKERS[current.speaker] || current.speaker || 'ツアーノート');
    localizeText($('#story-text'), current.text);
    localizeText($('#story-progress'), message("{0} / {1}", [line + 1, scene.lines.length]));
    const finalLine = line === scene.lines.length - 1;
    const choices = finalLine ? scene.choices || [] : [];
    const host = $('#story-choices');
    host.replaceChildren();
    for (const option of choices) {
      const button = root.createElement('button');
      const title = root.createElement('strong'); localizeText(title, option.label);
      const detail = root.createElement('span'); localizeText(detail, option.description || '');
      button.append(title, detail);
      button.addEventListener('click', () => {
        if (!scene) return;
        memory = chooseStoryOption(memory, scene, option.id);
        finish();
      });
      host.append(button);
    }
    $('#story-next').hidden = choices.length > 0;
    localizeText($('#story-next'), finalLine ? (journal ? '記録を閉じる' : 'ほな、行こ →') : 'つづき →');
    $('#story-skip').hidden = !journal && finalLine;
    localizeText($('#story-skip'), journal ? '記録を閉じる' : '会話を閉じる');
    const history = $('#story-history');
    history.replaceChildren();
    for (const entry of getStoryJournal(memory).slice(-12)) {
      const item = root.createElement('p'); localizeText(item, message("{0} / {1}", [entry.kicker, entry.summary]));
      history.append(item);
    }
    (choices.length ? host.querySelector('button') : $('#story-next')).focus({ preventScroll: true });
  }
  function open(next, done, isJournal = false) {
    if (scene) return false;
    if (!next?.lines?.length) { done?.(); return false; }
    scene = next; line = 0; complete = done; journal = isJournal;
    onOpen(); render();
    panel.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    return true;
  }
  $('#story-next').addEventListener('click', () => {
    if (!scene) return;
    if (line < scene.lines.length - 1) { line++; render(); }
    else if (!scene.choices?.length) finish();
  });
  $('#story-skip').addEventListener('click', () => {
    if (!scene) return;
    if (journal) { finish(); return; }
    if (scene.choices?.length) { line = scene.lines.length - 1; render(); }
    else finish();
  });
  panel.addEventListener('keydown', event => {
    if (event.repeat && ['Enter', 'Space'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape' && journal) { event.preventDefault(); event.stopPropagation(); finish(); }
  });
  return {
    show(trigger, done) {
      if (scene) return false;
      const state = getState();
      const nextMemory = storyMemoryForRun(memory, state?.runId, state?.routeIndex);
      if (nextMemory.runId !== memory.runId) { memory = nextMemory; persist(); }
      return open(getStoryScene(state, trigger, memory), done);
    },
    journal(done) {
      const entries = getStoryJournal(memory);
      return open({ id: 'journal', kicker: 'TOUR JOURNAL / うちらの記録', lines: entries.length
        ? entries.map(entry => ({ speaker: 'ツアーノート', text: `${entry.kicker} ${entry.summary}` }))
        : [{ speaker: 'ツアーノート', text: '6つのクラブで音と仲間を集めて、京都でひとつのミックスに。ここに旅の記録が増えていくで。' }], choices: [] }, done, true);
    },
    get memory() { return normalizeStoryMemory(memory); },
    get active() { return Boolean(scene); },
  };
}
