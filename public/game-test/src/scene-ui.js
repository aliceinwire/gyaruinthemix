/** Explicit DOM scenes. Live HUD never resizes, crops or covers the world. */
export const SCREENS = Object.freeze([
  "menu", "cars", "map", "playing", "quiz", "result", "finale", "story", "draft",
]);

const PANELS = Object.freeze([
  ["#route-panel", "map"],
  ["#car-select", "cars"],
  ["#menu", "menu"],
  ["#result", "result"],
  ["#quiz", "quiz"],
  ["#story-panel", "story"],
  ["#draft-panel", "draft"],
]);
const DIALOGS = ["#pause-overlay", "#story-panel", "#draft-panel", "#quiz", "#result"];
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]';

export function createSceneUI(root = document) {
  const get = (id) => root.querySelector(id);
  const setHidden = (id, hidden) => {
    const node = get(id);
    if (node) node.hidden = hidden;
  };
  const setDisabled = (id, disabled) => {
    const node = get(id);
    if (node) node.disabled = disabled;
  };
  const controls = () => root.querySelectorAll?.("[data-control]") || [];
  const visibleControls = (dialog) => [...(dialog.querySelectorAll?.(FOCUSABLE) || [])]
    .filter((node) => !node.hidden && !node.closest?.("[hidden], [inert]") &&
      (!node.getClientRects || node.getClientRects().length > 0));

  function focusPanel(id) {
    const dialog = get(id);
    if (!dialog || dialog.hidden) return;
    const first = visibleControls(dialog)[0];
    (first || dialog).focus?.({ preventScroll: true });
  }

  function show(screen) {
    if (!SCREENS.includes(screen)) throw new Error(`Unknown screen: ${screen}`);
    if (root.body) root.body.dataset.screen = screen;
    get(".viewport")?.classList?.toggle("map-view", screen === "map");
    get(".viewport")?.classList?.toggle("finale-view", screen === "finale");
    for (const [id, panelScreen] of PANELS) setHidden(id, panelScreen !== screen);
    setHidden("#pause-overlay", true);
    setDisabled("#pause", screen !== "playing" && screen !== "finale");
    setDisabled("#run-journal", !["map", "playing", "finale", "result"].includes(screen));
    controls().forEach((button) => { button.disabled = screen !== "playing"; });
    const panel = PANELS.find(([id, state]) => state === screen && DIALOGS.includes(id));
    if (panel) focusPanel(panel[0]);
  }

  function mapPanel(panel) {
    const garage = panel === "garage";
    if (root.body) root.body.dataset.mapPanel = garage ? "garage" : "route";
    setHidden("#route-content", garage);
    setHidden("#garage-content", !garage);
    get("#route-tab")?.setAttribute?.("aria-pressed", String(!garage));
    get("#garage-tab")?.setAttribute?.("aria-pressed", String(garage));
  }

  root.addEventListener?.("keydown", (event) => {
    if (event.code !== "Tab" && event.key !== "Tab") return;
    const dialog = DIALOGS.map(get).find((node) => node && !node.hidden);
    if (!dialog) return;
    const buttons = visibleControls(dialog);
    if (!buttons.length) {
      event.preventDefault();
      dialog.focus?.({ preventScroll: true });
      return;
    }
    const first = buttons[0], last = buttons.at(-1);
    const outside = !dialog.contains?.(root.activeElement);
    if (event.shiftKey && (root.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (root.activeElement === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  });
  return { show, mapPanel, focusPanel };
}
