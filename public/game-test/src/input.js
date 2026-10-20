/** Four-action input. Each pointer is independent; all transitions release it. */
export const KEY_ACTIONS = Object.freeze({
  ShiftLeft: "rush",
  ShiftRight: "rush",
  KeyX: "rush",
  Space: "boost",
  ArrowUp: "boost",
  KeyW: "boost",
  KeyZ: "shoot",
  KeyJ: "shoot",
  KeyE: "charge",
  KeyC: "charge",
});
export function createInputState(onChange = () => {}) {
  const keys = new Set(),
    pointers = new Map();
  const input = { boost: false, shoot: false, charge: false, rush: false };
  function sync() {
    for (const action of Object.keys(input))
      input[action] =
        [...keys].some((key) => KEY_ACTIONS[key] === action) ||
        [...pointers.values()].includes(action);
    onChange(input);
  }
  return {
    input,
    keyDown(code) {
      if (Object.hasOwn(KEY_ACTIONS, code)) {
        keys.add(code);
        sync();
      }
    },
    keyUp(code) {
      keys.delete(code);
      sync();
    },
    pointerDown(id, action) {
      if (Object.hasOwn(input, action)) {
        pointers.set(id, action);
        sync();
      }
    },
    pointerUp(id) {
      pointers.delete(id);
      sync();
    },
    release() {
      keys.clear();
      pointers.clear();
      sync();
    },
  };
}
export function bindGameInput({
  root = document,
  win = window,
  isPlaying,
  isQuiz,
  isPaused,
  onPause,
  onAnswer,
  onInteraction,
}) {
  const buttons = [...root.querySelectorAll("[data-control]")];
  const state = createInputState((input) =>
    buttons.forEach((button) =>
      button.classList.toggle("active", input[button.dataset.control]),
    ),
  );
  const listeners = [];
  const listen = (node, type, fn) => {
    node.addEventListener(type, fn);
    listeners.push(() => node.removeEventListener(type, fn));
  };
  listen(win, "keydown", (event) => {
    if (isQuiz() && /^Digit[123]$/.test(event.code)) {
      event.preventDefault();
      onAnswer(Number(event.code.slice(-1)) - 1);
      return;
    }
    const interactive = event.target?.closest?.(
      "button,a,input,select,textarea,[role=slider],[contenteditable=true]",
    );
    if (
      Object.hasOwn(KEY_ACTIONS, event.code) &&
      isPlaying() &&
      !isPaused() &&
      (!interactive || interactive.matches("[data-control]"))
    ) {
      event.preventDefault();
      state.keyDown(event.code);
    }
    if (
      (event.code === "KeyP" || event.code === "Escape") &&
      !event.repeat &&
      isPlaying()
    ) {
      event.preventDefault();
      onPause(!isPaused());
    }
  });
  listen(win, "keyup", (event) => state.keyUp(event.code));
  const unfocus = () => {
    state.release();
    if (isPlaying()) onPause(true);
  };
  listen(win, "blur", unfocus);
  listen(root, "visibilitychange", () => {
    if (root.hidden) unfocus();
  });
  for (const button of buttons) {
    listen(button, "pointerdown", (event) => {
      event.preventDefault();
      if (!isPlaying() || isPaused()) return;
      state.pointerDown(event.pointerId, button.dataset.control);
      try {
        button.setPointerCapture(event.pointerId);
      } catch {}
      onInteraction();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      listen(button, type, (event) => state.pointerUp(event.pointerId));
    listen(button, "contextmenu", (event) => event.preventDefault());
  }
  return {
    ...state,
    destroy() {
      state.release();
      listeners.forEach((remove) => remove());
    },
  };
}
