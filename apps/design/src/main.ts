// Deliberate order: the `@font-face` rules first (taken as they are from the
// demo, the `/fonts/*.woff2` URLs resolve through the shared `publicDir`), then
// the shell's stylesheet. The `--ds-*` variables are injected further down —
// not imported: see the comment at the injection.
import "../../demo/src/fonts.css";
import "./style.css";
// The chrome primitives' stylesheet, the very one the demo loads. The UI
// components board therefore shows the product's components, dressed by their
// real rules — and not a copy, as was the case before those primitives were
// extracted. After `style.css`: the token variables it consumes are injected
// further down, and the cascade wants the shell to be overridable, not the
// other way round.
import "@chrome/chrome.css";

import { renderTokensCss } from "@tokens/css.ts";
import { onThemeChange, setTheme, themeState, type ThemeState } from "./theme-state.ts";
// After `./style.css`: a view imports its own stylesheet, and that one must be
// able to override the shell's — the import order IS the cascade order.
import { mountGraphComponentsView } from "./views/graph-components.ts";
import { mountSandboxView } from "./views/sandbox.ts";
import { mountTokensView } from "./views/tokens.ts";
import { mountUiComponentsView } from "./views/ui-components.ts";

/**
 * The contract of a playground view.
 *
 * `mount` receives an EMPTY element it alone owns, and returns its unmount.
 * That return is not a courtesy: the views ahead create Pixi canvases and theme
 * subscriptions that nothing else can release in their stead. The shell calls
 * the cleanup before emptying the container, never the other way round.
 *
 * `state` is passed as an argument rather than read from `theme-state` by the
 * view: a view thus stays a function of the theme, testable without global
 * state.
 */
export interface PlaygroundView {
  id: string;
  label: string;
  mount(root: HTMLElement, state: ThemeState): () => void;
}

// The landing view is named, not derived from a `VIEWS[0]`: reordering the
// registry must not move the arrival screen behind the back of whoever
// reorders.
const TOKENS_VIEW: PlaygroundView = { id: "tokens", label: "Tokens", mount: mountTokensView };

const VIEWS: PlaygroundView[] = [
  TOKENS_VIEW,
  { id: "graph", label: "Composants graphe", mount: mountGraphComponentsView },
  { id: "ui", label: "Composants UI", mount: mountUiComponentsView },
  { id: "sandbox", label: "Bac à sable", mount: mountSandboxView },
];

const DEFAULT_VIEW = TOKENS_VIEW;

// --- The CSS variables.
//
// Injected instead of being imported from a generated `.css` as the demo does:
// the playground must show the tokens as they are in `packages/tokens/src` at
// this very moment. Going through `renderTokensCss()` makes the CSS module
// code, hence subject to Vite's HMR — fixing a color in the source repaints the
// whole playground with nothing to regenerate. A committed `tokens.css` would
// have required `pnpm generate:css` between every attempt, which is precisely
// the back-and-forth this test bench removes.
const tokensStyle = document.createElement("style");
tokensStyle.textContent = renderTokensCss();
document.head.append(tokensStyle);

const app = document.getElementById("app");
if (!app) throw new Error("#app container not found");

// --- The shell.

const shell = document.createElement("div");
shell.className = "shell";

const sidebar = document.createElement("nav");
sidebar.className = "sidebar";
sidebar.setAttribute("aria-label", "Vues du playground");

const brandEl = document.createElement("div");
brandEl.className = "sidebar-brand";
brandEl.textContent = "data-graph";
sidebar.append(brandEl);

// Links, not buttons: the route IS the hash, so the element leading to it must
// be navigable, openable in a tab, and announced as a link.
const navLinks = new Map<string, HTMLAnchorElement>();
for (const view of VIEWS) {
  const link = document.createElement("a");
  link.className = "nav-link";
  link.href = `#/${view.id}`;
  link.textContent = view.label;
  navLinks.set(view.id, link);
  sidebar.append(link);
}

const topbar = document.createElement("header");
topbar.className = "topbar";

const title = document.createElement("h1");
title.className = "topbar-title";
topbar.append(title);

const controls = document.createElement("div");
controls.className = "topbar-controls";

const brandSelect = document.createElement("select");
brandSelect.className = "control";
brandSelect.id = "brand-select";
for (const [value, label] of [
  ["defsquare", "defsquare"],
  ["neutral", "neutral"],
] as const) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  brandSelect.append(option);
}
const brandLabel = document.createElement("label");
brandLabel.className = "control-label";
brandLabel.htmlFor = brandSelect.id;
brandLabel.textContent = "Marque";
controls.append(brandLabel, brandSelect);

const modeBtn = document.createElement("button");
modeBtn.type = "button";
modeBtn.className = "control";
controls.append(modeBtn);

topbar.append(controls);

const content = document.createElement("main");
content.className = "content";

shell.append(sidebar, topbar, content);
app.append(shell);

// --- Mounting and routing.

let unmount: (() => void) | null = null;
let mounted: PlaygroundView | null = null;

function viewFromHash(): PlaygroundView {
  const id = window.location.hash.replace(/^#\//, "");
  return VIEWS.find((v) => v.id === id) ?? DEFAULT_VIEW;
}

function render(): void {
  const view = viewFromHash();
  const state = themeState();

  // Unmount BEFORE emptying: the view must be able to touch its DOM one last
  // time (destroy a Pixi canvas, remove listeners) while it still exists.
  // Guarded: a view cleanup that throws must not condemn the remount. Without
  // this guard, the exception abandons `render()` — the new view is never
  // mounted and the screen stays frozen on the previous theme, a far more
  // visible failure than the botched cleanup that caused it. The error still
  // reaches the console.
  try {
    unmount?.();
  } catch (error: unknown) {
    console.error("Le démontage de la vue a échoué, on remonte quand même :", error);
  }
  unmount = null;
  content.replaceChildren();

  mounted = view;
  unmount = view.mount(content, state);

  title.textContent = view.label;
  for (const [id, link] of navLinks) {
    // `aria-current` carries the information, the class carries the style: both
    // derive from the same boolean, so they cannot diverge.
    if (id === view.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    link.classList.toggle("is-active", id === view.id);
  }
}

function syncControls(state: ThemeState): void {
  brandSelect.value = state.brand;
  // The button names the mode it WOULD activate, not the one in place — same
  // convention as the demo's menu entry.
  const next = state.mode === "dark" ? "clair" : "sombre";
  modeBtn.textContent = `Thème ${next}`;
  modeBtn.setAttribute("aria-label", `Passer au thème ${next}`);
}

modeBtn.addEventListener("click", () => {
  setTheme({ mode: themeState().mode === "dark" ? "light" : "dark" });
});

brandSelect.addEventListener("change", () => {
  setTheme({ brand: brandSelect.value as ThemeState["brand"] });
});

// Any theme change REMOUNTS the active view. That is blunter than a renderer's
// `setTheme()` applied live, and it is deliberate: the views ahead draw with
// Pixi, where only colors repaint live — fonts, stroke widths and radii require
// a rebuild. A systematic remount guarantees that what is on screen matches the
// theme announced, whatever a view has put inside it.
onThemeChange((state) => {
  syncControls(state);
  render();
});

window.addEventListener("hashchange", () => {
  // A hash landing back on the already mounted view (link clicked again,
  // `#/unknown`) must not rebuild it: it would lose its state for nothing.
  if (viewFromHash() === mounted) return;
  render();
});

syncControls(themeState());

// Top-level await (es2022 target, cf. `vite.config.ts`). The views ahead build
// Pixi BitmapFonts, which MEASURE glyphs by family name: mounting before the
// woff2 files are loaded would measure the fallback font, and the widths baked
// into the atlas would stay wrong even once the real font arrived.
// `font-display: swap` serves the DOM, not a canvas. So we wait here, once,
// before the very first mount.
await document.fonts.ready;

// No hash on load: we set one, so that the URL always describes what is
// displayed (and stays shareable / reloadable).
if (!window.location.hash) window.location.hash = `#/${DEFAULT_VIEW.id}`;
render();
