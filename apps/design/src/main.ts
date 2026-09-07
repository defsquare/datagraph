// Ordre volontaire : les `@font-face` d'abord (repris tels quels de la démo,
// les URLs `/fonts/*.woff2` résolvent par le `publicDir` partagé), puis la
// feuille du shell. Les variables `--ds-*`, elles, sont injectées plus bas —
// pas importées : voir le commentaire de l'injection.
import "../../demo/src/fonts.css";
import "./style.css";

import { renderTokensCss } from "@tokens/css.ts";
import { onThemeChange, setTheme, themeState, type ThemeState } from "./theme-state.ts";
// Après `./style.css` : une vue importe sa propre feuille, et celle-ci doit
// pouvoir surcharger celle du shell — l'ordre des imports EST l'ordre en
// cascade.
import { mountGraphComponentsView } from "./views/graph-components.ts";
import { mountTokensView } from "./views/tokens.ts";

/**
 * Le contrat d'une vue du playground.
 *
 * `mount` reçoit un élément VIDE dont elle est seule propriétaire, et retourne
 * son démontage. Ce retour n'est pas une politesse : les vues à venir créent
 * des canvases Pixi et des abonnements au thème, que rien d'autre ne peut
 * libérer à leur place. Le shell appelle le cleanup avant de vider le
 * conteneur, jamais l'inverse.
 *
 * `state` est passé en argument plutôt que lu depuis `theme-state` par la vue :
 * une vue reste ainsi une fonction du thème, testable sans état global.
 */
export interface PlaygroundView {
  id: string;
  label: string;
  mount(root: HTMLElement, state: ThemeState): () => void;
}

/** Vue provisoire : les tâches suivantes remplacent chaque entrée du registre
 * par son vrai module (`mountTokensView`, etc.), de cette même forme. */
function placeholder(id: string, label: string): PlaygroundView {
  return {
    id,
    label,
    mount(root) {
      const p = document.createElement("p");
      p.className = "placeholder";
      p.textContent = `Vue « ${label} » — à venir.`;
      root.append(p);
      return () => {};
    },
  };
}

// La vue d'accueil est nommée, pas déduite d'un `VIEWS[0]` : réordonner le
// registre ne doit pas déplacer l'écran d'arrivée à l'insu de celui qui
// réordonne.
const TOKENS_VIEW: PlaygroundView = { id: "tokens", label: "Tokens", mount: mountTokensView };

const VIEWS: PlaygroundView[] = [
  TOKENS_VIEW,
  { id: "graph", label: "Composants graphe", mount: mountGraphComponentsView },
  placeholder("ui", "Composants UI"),
  placeholder("sandbox", "Bac à sable"),
];

const DEFAULT_VIEW = TOKENS_VIEW;

// --- Les variables CSS.
//
// Injectées au lieu d'être importées depuis un `.css` généré comme le fait la
// démo : le playground doit montrer les tokens tels qu'ils sont dans
// `packages/tokens/src` à l'instant présent. En passant par `renderTokensCss()`
// le module CSS est du code, donc soumis au HMR de Vite — corriger une couleur
// dans la source repeint le playground entier sans rien régénérer. Un
// `tokens.css` committé, lui, aurait exigé `pnpm generate:css` entre chaque
// essai, ce qui est précisément le va-et-vient que ce banc d'essai supprime.
const tokensStyle = document.createElement("style");
tokensStyle.textContent = renderTokensCss();
document.head.append(tokensStyle);

const app = document.getElementById("app");
if (!app) throw new Error("#app container not found");

// --- Le shell.

const shell = document.createElement("div");
shell.className = "shell";

const sidebar = document.createElement("nav");
sidebar.className = "sidebar";
sidebar.setAttribute("aria-label", "Vues du playground");

const brandEl = document.createElement("div");
brandEl.className = "sidebar-brand";
brandEl.textContent = "data-graph";
sidebar.append(brandEl);

// Des liens, pas des boutons : la route EST le hash, donc l'élément qui y mène
// doit être navigable, ouvrable dans un onglet et annonçable comme un lien.
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

// --- Montage et routage.

let unmount: (() => void) | null = null;
let mounted: PlaygroundView | null = null;

function viewFromHash(): PlaygroundView {
  const id = window.location.hash.replace(/^#\//, "");
  return VIEWS.find((v) => v.id === id) ?? DEFAULT_VIEW;
}

function render(): void {
  const view = viewFromHash();
  const state = themeState();

  // Démonter AVANT de vider : la vue doit pouvoir toucher son DOM une dernière
  // fois (détruire un canvas Pixi, retirer des écouteurs) pendant qu'il existe.
  unmount?.();
  unmount = null;
  content.replaceChildren();

  mounted = view;
  unmount = view.mount(content, state);

  title.textContent = view.label;
  for (const [id, link] of navLinks) {
    // `aria-current` porte l'information, la classe porte le style : les deux
    // dérivent du même booléen, ils ne peuvent pas diverger.
    if (id === view.id) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    link.classList.toggle("is-active", id === view.id);
  }
}

function syncControls(state: ThemeState): void {
  brandSelect.value = state.brand;
  // Le bouton nomme le mode qu'il ACTIVERAIT, pas celui en place — même
  // convention que l'entrée de menu de la démo.
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

// Tout changement de thème REMONTE la vue active. C'est plus brutal qu'un
// `setTheme()` de renderer appliqué à chaud, et c'est délibéré : les vues à
// venir dessinent avec Pixi, où seules les couleurs se repeignent à chaud —
// polices, épaisseurs et rayons demandent une reconstruction. Un remontage
// systématique garantit que ce qui est à l'écran correspond au thème affiché,
// quel que soit ce qu'une vue a mis dedans.
onThemeChange((state) => {
  syncControls(state);
  render();
});

window.addEventListener("hashchange", () => {
  // Un hash qui retombe sur la vue déjà montée (lien re-cliqué, `#/inconnu`)
  // ne doit pas la reconstruire : elle perdrait son état pour rien.
  if (viewFromHash() === mounted) return;
  render();
});

syncControls(themeState());

// Top-level await (cible es2022, cf. `vite.config.ts`). Les vues à venir
// construisent des BitmapFonts Pixi, qui MESURENT les glyphes par nom de
// famille : monter avant que les woff2 ne soient chargées ferait mesurer la
// police de repli, et les largeurs figées dans l'atlas resteraient fausses même
// une fois la vraie police arrivée. `font-display: swap` sert le DOM, pas un
// canvas. On attend donc ici, une fois, avant le tout premier montage.
await document.fonts.ready;

// Pas de hash au chargement : on en pose un, pour que l'URL décrive toujours ce
// qui est affiché (et soit partageable / rechargeable).
if (!window.location.hash) window.location.hash = `#/${DEFAULT_VIEW.id}`;
render();
