import {
  defsquareDark,
  defsquareLight,
  neutralDark,
  neutralLight,
  type Theme,
} from "@renderer/theme.ts";

/**
 * L'état de thème du playground, et l'unique endroit qui le mute.
 *
 * Deux axes indépendants — la MARQUE (quel jeu de couleurs) et le MODE (clair
 * ou sombre) — parce que c'est ainsi que le renderer expose ses quatre thèmes.
 * Les croiser en un seul énuméré à quatre valeurs obligerait chaque contrôle de
 * l'interface à connaître les trois autres combinaisons pour savoir vers
 * laquelle basculer.
 *
 * Un seul module porte cet état : les vues (tokens, composants, bac à sable)
 * s'abonnent, elles ne se le passent pas entre elles. Une vue qui recevrait le
 * thème par un chemin détourné se désynchroniserait le jour où quelqu'un
 * ajoute un raccourci clavier ou une restauration d'URL.
 */
export interface ThemeState {
  brand: "defsquare" | "neutral";
  mode: "light" | "dark";
}

// Table plutôt que quatre `if` : la seule connaissance que ce module a des
// thèmes du renderer est ce croisement, et il se lit d'un coup d'œil.
const THEMES: Record<ThemeState["brand"], Record<ThemeState["mode"], Theme>> = {
  defsquare: { light: defsquareLight, dark: defsquareDark },
  neutral: { light: neutralLight, dark: neutralDark },
};

let state: ThemeState = { brand: "defsquare", mode: "light" };

const subscribers = new Set<(s: ThemeState) => void>();

/** Instantané de l'état courant. Copie : un appelant qui muterait l'objet
 * interne contournerait `setTheme` et personne ne serait notifié. */
export function themeState(): ThemeState {
  return { ...state };
}

/** Le thème Pixi correspondant à un état. Pur : les vues qui construisent un
 * canvas le rappellent à chaque remontage plutôt que de mémoriser une
 * référence. */
export function currentTheme(s: ThemeState): Theme {
  return THEMES[s.brand][s.mode];
}

/** S'abonne aux changements. Retourne le désabonnement — les vues l'appellent
 * dans leur cleanup, sans quoi une vue démontée continuerait de réagir et
 * tiendrait en vie son canvas détruit. */
export function onThemeChange(cb: (s: ThemeState) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Modifie un ou deux axes, puis notifie.
 *
 * Sortie anticipée si rien ne change : reposer le même thème provoquerait un
 * remontage complet des vues (donc la recréation des canvases Pixi) pour rien.
 */
export function setTheme(patch: Partial<ThemeState>): void {
  const next: ThemeState = { ...state, ...patch };
  if (next.brand === state.brand && next.mode === state.mode) return;
  state = next;
  applyMode();
  // Itération sur une copie : un abonné peut se désabonner depuis son propre
  // rappel — c'est exactement ce que fait une vue qui se démonte en réaction.
  for (const cb of [...subscribers]) cb(themeState());
}

/**
 * Le mode passe au CSS par `data-theme` sur `<html>` — même mécanisme que
 * `apps/demo/src/chrome.ts`, et c'est le sélecteur sur lequel la feuille
 * générée par le paquet de tokens (`html[data-theme="dark"]`) surcharge ses
 * couleurs. La marque, elle, ne change que les thèmes Pixi : les variables CSS
 * générées ne couvrent aujourd'hui que la palette defsquare.
 */
function applyMode(): void {
  document.documentElement.setAttribute("data-theme", state.mode);
}

// L'attribut est déjà posé dans `index.html`, mais l'y laisser seul ferait de
// l'état initial une vérité en deux exemplaires. On le réaffirme depuis l'état.
applyMode();
