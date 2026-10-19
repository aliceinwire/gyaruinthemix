/** Explicit DOM scenes: the game canvas is never resized or cropped by a menu. */
export const SCREENS = Object.freeze([
  "menu",
  "cars",
  "map",
  "playing",
  "quiz",
  "result",
  "finale",
]);
export function createSceneUI(root = document) {
  const get = (id) => root.querySelector(id);
  function show(screen) {
    if (!SCREENS.includes(screen)) throw new Error(`Unknown screen: ${screen}`);
    root.body.dataset.screen = screen;
    get(".viewport").classList.toggle("map-view", screen === "map");
    get(".viewport").classList.toggle("finale-view", screen === "finale");
    for (const [id, visible] of [
      ["#route-panel", screen === "map"],
      ["#car-select", screen === "cars"],
      ["#menu", screen === "menu"],
      ["#result", screen === "result"],
      ["#quiz", screen === "quiz"],
    ])
      get(id).hidden = !visible;
    get("#pause-overlay").hidden = true;
    get("#pause").disabled = screen !== "playing" && screen !== "finale";
    root
      .querySelectorAll("[data-control]")
      .forEach((button) => (button.disabled = screen !== "playing"));
  }
  function mapPanel(panel) {
    const garage = panel === "garage";
    root.body.dataset.mapPanel = garage ? "garage" : "route";
    get("#route-content").hidden = garage;
    get("#garage-content").hidden = !garage;
    get("#route-tab").setAttribute("aria-pressed", String(!garage));
    get("#garage-tab").setAttribute("aria-pressed", String(garage));
  }
  root.addEventListener?.("keydown", (event) => {
    if (event.code !== "Tab") return;
    const dialog = ["#quiz", "#pause-overlay", "#result"]
      .map(get)
      .find((node) => !node.hidden);
    if (!dialog) return;
    const controls = [
      ...dialog.querySelectorAll(
        'button:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]',
      ),
    ].filter((node) => !node.hidden && node.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0],
      last = controls.at(-1);
    if (
      event.shiftKey &&
      (root.activeElement === first || !dialog.contains(root.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (root.activeElement === last || !dialog.contains(root.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  return { show, mapPanel };
}
