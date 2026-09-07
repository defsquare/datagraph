import {
  createBadge,
  createCluster,
  createClusterSeparator,
  createFindbar,
  createIconButton,
  createMenu,
  createMenuItem,
  type IconName,
} from "@chrome/index.ts";

import "./ui-components.css";

/**
 * The « Composants UI » view: the DOM chrome's primitives — floating surface,
 * icon button, findbar, entity badge, menu item — each laid out as a row of
 * states.
 *
 * These specimens are the COMPONENTS THEMSELVES. They come out of
 * `@defsquare/data-graph-chrome`'s factories, the ones the demo calls, and are
 * dressed by the stylesheet the demo loads. Same regime as the graph components
 * board with respect to `draw.ts`: a specimen cannot lie about what the product
 * draws, because it IS what the product draws.
 *
 * This board did in fact start out copying the chrome's CSS and icons, for want
 * of being able to import them — that observation is what got the package
 * extracted. All that remains here is the caption around the objects on
 * display.
 *
 * Two stances found the board itself.
 *
 * 1. The states are REAL, never simulated. A "hover" cell is the real
 *    component, hovered; a "focus" cell is the real component, reached with
 *    Tab. No twin class of the `.is-hover` sort: it would only be a copy of the
 *    `:hover` rule, and would become false at the first touch-up. Owned
 *    corollary: several cells look alike at rest, and it is the CAPTION that
 *    states the gesture to perform.
 *
 * 2. The states that do not exist are DECLARED absent, not invented. The chrome
 *    defines neither `:active` for the menu item nor `:disabled` for the
 *    findbar's chevrons: the board shows that as it is and names it. A design
 *    system board must be usable to spot a hole; it cannot be if it patches the
 *    hole on the way past.
 *
 * No Pixi here, and that is the information: these components exist ONLY in the
 * DOM. Translucency, backdrop blur and drop shadows are exactly what the canvas
 * cannot do, and that is why the chrome stayed DOM above the canvas rather than
 * being drawn inside it.
 */

// --- The caption's DOM factories.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * A section's frame: title, note, row of cells.
 *
 * The classes belong to this view (`uic-*`) and are not those of the Tokens
 * (`ds-*`) or Composants graphe (`gc-*`) views: those live in ANOTHER view's
 * stylesheet, and leaning on them would break the day that other view renames
 * or moves its sheet, with nothing to announce it.
 */
function section(title: string, note: string): { node: HTMLElement; row: HTMLElement } {
  const node = el("section", "uic-section");
  node.append(el("h2", "uic-section-title", title));
  node.append(el("p", "uic-note", note));
  const row = el("div", "uic-row");
  node.append(row);
  return { node, row };
}

/**
 * A cell: the specimen on the checkerboard, its caption underneath.
 *
 * The caption accepts light markup (`<code>`) because it names attributes and
 * selectors — `disabled`, `aria-busy="true"` — that bare text would not set
 * apart from the surrounding prose.
 */
function cell(label: string, ...content: Node[]): HTMLElement {
  const node = el("div", "uic-cell");
  const stage = el("div", "uic-stage");
  stage.append(...content);
  const caption = el("p", "uic-cell-label");
  caption.innerHTML = label;
  node.append(stage, caption);
  return node;
}

/** A bare floating surface. `.float` is a class one SETS, not a component one
 * builds: it comes from the chrome's stylesheet, there is nothing to
 * manufacture. */
function float(extraClass: string | null, ...content: Node[]): HTMLElement {
  const node = el("div", extraClass ? `float ${extraClass}` : "float");
  node.append(...content);
  return node;
}

// --- Section 1: the floating surface.

function floatSection(): HTMLElement {
  const { node, row } = section(
    "Surface flottante",
    "Le socle de tout le chrome : --float-bg translucide, --float-border, --shadow-float, et un flou de 16px saturé à 160% appliqué à ce qui passe DERRIÈRE. Posé sur un damier, sans quoi « translucide » et « flouté » ne se distinguent pas d'un aplat. La surface elle-même n'est pas interactive : survol, focus, actif et désactivé appartiennent à ses enfants — les quatre sections suivantes.",
  );

  const body = el("div", "uic-float-body");
  body.append(
    el("div", undefined, "float-bg + float-border"),
    el("div", undefined, "shadow-float"),
    el("div", undefined, "backdrop-filter: blur(16px)"),
  );

  row.append(
    cell(
      "repos — <strong>son seul état</strong> : une surface ne se survole pas, ne prend pas le focus et ne se désactive pas.",
      float(null, body),
    ),
    cell(
      "la grappe d'icônes (<code>createCluster</code>) — la même surface, resserrée à 3px autour de ses boutons, avec son séparateur d'1px. C'est l'assemblage exact de la barre d'outils de la démo.",
      createCluster(
        createIconButton({ icon: "search", label: "Rechercher" }),
        createIconButton({ icon: "fit", label: "Ajuster à la vue" }),
        createIconButton({ icon: "graph", label: "Vue graphe" }),
        createClusterSeparator(),
        createIconButton({ icon: "dots", label: "Menu" }),
      ),
    ),
  );

  return node;
}

// --- Section 2: the icon button.

interface SpecimenButtonOptions {
  icon: IconName;
  label: string;
  small?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
}

/**
 * One of the product's buttons, set in the state we want to show.
 *
 * `disabled` and `aria-busy` are not options of `createIconButton` and must not
 * be: they are RUNTIME states, which the application sets and clears as it
 * goes — a factory taking them as arguments would suggest they are decided at
 * construction. The board therefore sets them the way the demo does, by
 * attribute, after the fact.
 */
function specimenButton(opts: SpecimenButtonOptions): HTMLButtonElement {
  const button = createIconButton({
    icon: opts.icon,
    label: opts.label,
    small: opts.small,
    // `aria-expanded` IS a factory argument: a panel trigger carries it from
    // construction, folded, without which it would announce a panel it does not
    // open.
    expanded: opts.expanded,
  });
  if (opts.busy) button.setAttribute("aria-busy", "true");
  if (opts.disabled) button.disabled = true;
  return button;
}

/** A lone button, but on its cluster: outside a floating surface, its hover tint
 * (`--float-hover`) would composite over the canvas and not over the glass,
 * hence over a color the product never shows. */
function loneButton(opts: SpecimenButtonOptions): HTMLElement {
  return createCluster(specimenButton(opts));
}

function iconButtonSection(): HTMLElement {
  const { node, row } = section(
    "Bouton d'icône",
    "L'unique commande du chrome : 30px, sans fond au repos, l'icône en --ds-muted. Chaque case ci-dessous est un vrai bouton — les états ne sont pas simulés, il faut les provoquer. Les deux derniers, eux, tiennent à un attribut et se lisent au repos.",
  );

  row.append(
    cell("repos", loneButton({ icon: "search", label: "Rechercher" })),
    cell(
      "survol — <strong>passez le pointeur</strong> : fond <code>--float-hover</code>, icône en <code>--ds-ink</code>.",
      loneButton({ icon: "search", label: "Rechercher" }),
    ),
    cell(
      "focus clavier — <strong>atteignez-le au Tab</strong> : liseré <code>--ds-primary</code> à 2px, décalé de 1px vers l'extérieur. Le clic ne le déclenche pas (<code>:focus-visible</code>).",
      loneButton({ icon: "search", label: "Rechercher" }),
    ),
    cell(
      "actif — <strong>maintenez le clic</strong> : le bouton descend d'un demi-pixel, tout l'enfoncement.",
      loneButton({ icon: "search", label: "Rechercher" }),
    ),
    cell(
      "<code>disabled</code> — opacité 0.45 et curseur par défaut ; il ne prend plus le focus.",
      loneButton({ icon: "search", label: "Rechercher", disabled: true }),
    ),
    cell(
      "<code>aria-expanded=\"true\"</code> — le panneau qu'il ouvre est déplié : le déclencheur reste allumé en <code>--ds-primary</code> sur un fond lavé à 14%.",
      loneButton({ icon: "dots", label: "Menu", expanded: true }),
    ),
    cell(
      "<code>aria-busy=\"true\"</code> + <code>disabled</code> — calcul en cours. Opacité 0.7 (plus claire que le simple désactivé : « en cours » n'est pas « pas disponible ») et pulsation lente, supprimée sous <code>prefers-reduced-motion</code>.",
      loneButton({ icon: "fit", label: "Ajuster à la vue", busy: true, disabled: true }),
    ),
    cell(
      "variante <code>small</code> (<code>.ibtn-sm</code>) — 24px, la seule autre taille du chrome ; elle ne sert qu'à fermer le panneau de détail. Mêmes états que ci-dessus.",
      loneButton({ icon: "close", label: "Fermer le panneau", small: true }),
    ),
    cell(
      "deux icônes dans un bouton — c'est ainsi que la bascule de vue porte l'état courant ET l'état cible, la feuille de la démo en masquant une selon <code>data-target</code>. Hors de la démo, aucune règle ne les départage : les deux se voient, ce qui est la structure nue.",
      createCluster(
        createIconButton({ icon: ["graph", "structure"], label: "Vue graphe" }),
      ),
    ),
  );

  return node;
}

// --- Section 3: the findbar.

interface FindbarSpecimenOptions {
  value?: string;
  counter?: string;
  disabled?: boolean;
}

function findbar(opts: FindbarSpecimenOptions = {}): HTMLElement {
  const bar = createFindbar();
  // The factory returns it FOLDED, as the demo needs: in the product, the
  // findbar only appears on a click on the magnifier. On the board it is the
  // object on display, hence permanently unfolded.
  bar.root.removeAttribute("hidden");

  if (opts.value !== undefined) bar.input.value = opts.value;
  if (opts.counter !== undefined) bar.counter.textContent = opts.counter;
  if (opts.disabled) {
    bar.input.disabled = true;
    bar.prev.disabled = true;
    bar.next.disabled = true;
  }
  return bar.root;
}

function findbarSection(): HTMLElement {
  const { node, row } = section(
    "Champ de recherche",
    "La barre dépliante : une surface flottante de 296×36 qui porte l'icône, le champ nu (ni bordure ni contour propres — c'est la BARRE qui réagit au focus), le compteur en chasse fixe et les deux chevrons de navigation. Les chevrons ont leurs propres survol et focus clavier, dans chacune des cases.",
  );

  row.append(
    cell("repos, champ vide — le compteur reste absent tant qu'aucune recherche n'a tourné.", findbar()),
    cell(
      "focus — <strong>cliquez dans le champ ou atteignez-le au Tab</strong> : c'est <code>:focus-within</code>, donc c'est la barre entière qui s'allume — bordure teintée et halo de 3px — pendant que le champ, lui, reste sans contour.",
      findbar(),
    ),
    cell(
      "avec résultats — le compteur « courant/total » apparaît entre le champ et les chevrons, et pousse ceux-ci sans jamais faire changer la barre de largeur (elle est fixée à 296px).",
      findbar({ value: "order", counter: "3/17" }),
    ),
    cell(
      "<code>disabled</code> sur le champ et les chevrons — <strong>et c'est un trou</strong> : le chrome ne définit aucune règle désactivée pour eux. Ce qu'on voit est le style par défaut du navigateur, pas une décision du design system.",
      findbar({ value: "order", counter: "0/0", disabled: true }),
    ),
  );

  return node;
}

// --- Section 4: the entity badge.

function badgeSample(type: string, label: string): HTMLElement {
  return float("uic-detail-sample", createBadge({ text: type }), el("p", "uic-detail-label", label));
}

function badgeSection(): HTMLElement {
  const { node, row } = section(
    "Pastille d'entité",
    "Le type du nœud sélectionné, en tête du panneau de détail : capitales, interlettrage ouvert, fond --ds-primary. Comme la surface flottante, elle n'est pas interactive — pas de survol, pas de focus, pas d'état désactivé. Montrée au-dessus du libellé du nœud, seul endroit où elle s'emploie, pour qu'on juge sa taille par rapport à lui.",
  );

  row.append(
    cell("repos — <strong>son seul état</strong>.", badgeSample("Order", "Order #4821")),
    cell(
      "libellé long — la pastille n'a ni largeur ni troncature : elle prend la place de son texte, et un type verbeux fait donc s'allonger la ligne.",
      badgeSample("PurchaseOrderLine", "PurchaseOrderLine #77-3"),
    ),
    cell(
      "l'encre est un <code>#ffffff</code> écrit en dur dans <code>chrome.css</code>, pas un token — <strong>le design system n'a pas d'encre « sur accent »</strong>. C'est la vraie règle qui s'applique ici, donc le trou se voit tel qu'il est.",
      badgeSample("Customer", "Customer #c1"),
    ),
  );

  return node;
}

// --- Section 5: the menu item.

interface MenuItemSpecimen {
  text: string;
  disabled?: boolean;
}

/**
 * The product's menu panel, unfolded.
 *
 * `createMenu` sets `role="menu"` and `hidden`, as the demo needs. The board
 * removes `hidden` — here the panel is the object on display — but keeps the
 * role: the board shows the component as it is, ARIA included. That role
 * promises arrow-key navigation which neither the demo nor the board
 * implements; it is a gap in the product, and hiding it here would amount to
 * precisely what this board exists to prevent.
 */
function menuPanel(items: MenuItemSpecimen[]): HTMLElement {
  const panel = createMenu(
    {},
    ...items.map((item) => {
      const button = createMenuItem({ label: item.text });
      if (item.disabled) button.disabled = true;
      return button;
    }),
  );
  panel.removeAttribute("hidden");
  return panel;
}

function menuSection(): HTMLElement {
  const { node, row } = section(
    "Item de menu",
    "Les entrées du menu ⋮ : du texte seul, sur toute la largeur du panneau. Elles n'ont pas d'icône par construction — la démo réécrit leur textContent pour refléter l'état courant (« Thème sombre » / « Thème clair »), ce qu'un enfant icône ne survivrait pas. Ici chaque entrée porte dans son propre libellé l'état qu'elle demande.",
  );

  row.append(
    cell(
      "les quatre états, une entrée chacun. Le focus clavier pose son liseré à l'INTÉRIEUR (<code>outline-offset: -2px</code>) : l'entrée occupant toute la largeur, un liseré extérieur déborderait du panneau.",
      menuPanel([
        { text: "Repos" },
        { text: "Survolez-moi" },
        { text: "Tab jusqu'ici pour le focus" },
        { text: "Désactivée (disabled)", disabled: true },
      ]),
    ),
    cell(
      "<strong>pas d'état actif</strong> : le chrome ne définit aucune règle <code>:active</code> pour l'item de menu, là où le bouton d'icône en a une. Maintenir le clic ne produit donc rien — asymétrie constatée, pas rebouchée ici.",
      menuPanel([{ text: "Maintenez le clic : rien ne bouge" }]),
    ),
    cell(
      "le menu réel de la démo, pour l'échelle : deux entrées, panneau de 216px de large, 5px de marge intérieure.",
      menuPanel([{ text: "Jeu de données étendu (4000)" }, { text: "Thème sombre" }]),
    ),
  );

  return node;
}

// --- Mounting.

/**
 * Mounts the view. Conforms to `PlaygroundView.mount`'s contract: `root` is
 * empty and ours, the return unmounts.
 *
 * The contract's `state` parameter is not declared — this view does not need
 * it. Everything it draws is dressed by the generated CSS variables, which
 * follow `data-theme` on `<html>`; the theme therefore arrives through the
 * cascade, without the view having to read it. That is also what makes it the
 * only one to survive a mode toggle as it stands — the shell remounts it
 * anyway, for uniformity with the Pixi views, which cannot.
 *
 * No resource to release either: no canvas, no subscription, no listener
 * outside `root`. The cleanup is thus limited to removing the subtree.
 */
export function mountUiComponentsView(root: HTMLElement): () => void {
  const page = el("div", "ui-components-view");
  page.append(
    floatSection(),
    iconButtonSection(),
    findbarSection(),
    badgeSection(),
    menuSection(),
  );
  root.append(page);

  return () => {
    page.remove();
  };
}
