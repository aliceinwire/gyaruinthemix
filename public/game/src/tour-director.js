import { localizeText } from './localized-ui.js';
import { message } from './i18n.js';
import { getStoryScene, normalizeStoryMemory, storyMemoryForRun, markStorySeen, chooseStoryOption, getStoryJournal, STORY_SPEAKERS } from './tour-story.js';

export const STORY_SAVE_KEY = 'gyaruinthemix-tour-story-v2';
const SAVE_VERSION = 3;
const runKey = value => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;

/** Older journals remain an archive, never future events in a fresh tour. */
export function normalizeStorySave(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (value?.version === SAVE_VERSION && value && typeof value === 'object' && !Array.isArray(value)) {
    return { version: SAVE_VERSION, runId: runKey(value.runId), current: normalizeStoryMemory(value.current), archive: normalizeStoryMemory(value.archive) };
  }
  const legacy = normalizeStoryMemory(value), legacyRunId = runKey(legacy.runId);
  return { version: SAVE_VERSION, runId: legacyRunId, current: legacyRunId ? legacy : normalizeStoryMemory(), archive: legacy };
}

/** Narrative owns its text and reading pace; the host owns simulation transitions. */
export function createStoryDirector({ root = document, storage, getState, onOpen, onSaveError = () => {} }) {
  const $ = selector => root.querySelector(selector);
  let saved;
  try { saved = normalizeStorySave(storage?.getItem(STORY_SAVE_KEY)); }
  catch { saved = normalizeStorySave(); }
  let memory = saved.current, archive = saved.archive, activeRunId = saved.runId;
  let scene = null, line = 0, complete = null, journal = false;
  const panel = $('#story-panel');
  function bindRun() {
    const state = getState(), id = runKey(state?.runId);
    if (id === activeRunId) return false;
    const hasFutureScenes = [...archive.seen, ...archive.history].some(sceneId => {
      const road = /^(?:departure|arrival|retry):(\d+)(?::|$)/.exec(sceneId);
      return road ? Number(road[1]) > state?.routeIndex : sceneId === 'tour:finale' && (state?.routeIndex !== 11 || state?.status !== 'won');
    });
    const legacyResume = activeRunId === null && !archive.runId && !hasFutureScenes && Number.isInteger(state?.routeIndex) && state.routeIndex > 0 && state.routeIndex < 12;
    activeRunId = id;
    memory = legacyResume ? storyMemoryForRun(archive, id, state.routeIndex) : { ...normalizeStoryMemory(), ...(id ? { runId: id } : {}) };
    persist();
    return true;
  }
  function persist() {
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(STORY_SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, runId: activeRunId, current: memory, archive }));
    } catch { onSaveError(); }
  }
  function finish() {
    if (!scene) return;
    if (!journal) {
      memory = markStorySeen(memory, scene.id);
      archive = markStorySeen(archive, scene.id);
      const choice = memory.choices[scene.id];
      if (choice) archive = chooseStoryOption(archive, scene, choice);
      persist();
    }
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
    panel.dataset.journal = String(isJournal);
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
    beginRun() { return scene ? false : bindRun(); },
    show(trigger, done) {
      if (scene) return false;
      bindRun();
      const selected = trigger === 'opening' && !memory.seen.includes('tour:opening') && (archive.seen.includes('tour:opening') || archive.seen.includes('tour:returning')) ? 'returning' : trigger;
      return open(getStoryScene(getState(), selected, memory), done);
    },
    journal(done) {
      if (scene) return false;
      bindRun();
      const entries = getStoryJournal(memory);
      return open({ id: 'journal', kicker: 'PURI ALBUM / うちらの記録', lines: entries.length
        ? entries.map(entry => ({ speaker: 'ツアーノート', text: `${entry.kicker} ${entry.summary}` }))
        : [{ speaker: 'ツアーノート', text: 'このツアーの一枚目は、これから。出会った仲間とクラブの思い出を、ここに残そ。' }], choices: [] }, done, true);
    },
    get memory() { return normalizeStoryMemory(memory); },
    get archive() { return normalizeStoryMemory(archive); },
    get active() { return Boolean(scene); },
  };
}
