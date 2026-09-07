import "./ui-components.css";

/**
 * La vue « Composants UI » : les primitives du chrome DOM — surface flottante,
 * bouton d'icône, champ de recherche, pastille d'entité, item de menu — chacune
 * déclinée en rangée d'états.
 *
 * Deux partis pris fondent cette planche.
 *
 * 1. Les états sont RÉELS, jamais simulés. Une case « survol » est le vrai
 *    composant, qu'on survole ; une case « focus » est le vrai composant, qu'on
 *    atteint au Tab. Aucune classe jumelle du genre `.is-hover` : elle ne
 *    serait qu'une copie de la règle `:hover`, et deviendrait fausse dès que
 *    l'une des deux changerait sans l'autre — c'est-à-dire dès la première
 *    retouche. Corollaire assumé : plusieurs cases se ressemblent au repos, et
 *    c'est la LÉGENDE qui dit le geste à faire. Le prix est faible ; la
 *    garantie qu'aucun spécimen ne ment, non.
 *
 * 2. Les états qui n'existent pas sont DITS absents, pas inventés. Le chrome de
 *    la démo ne définit ni `:active` pour l'item de menu, ni `:disabled` pour
 *    les chevrons de la recherche : la planche le montre tel quel et le nomme.
 *    Une planche de design system doit pouvoir servir à repérer un trou ; elle
 *    ne le peut pas si elle le rebouche en passant.
 *
 * Le CSS, lui, est une RECOPIE de `apps/demo/src/style.css` sous des classes
 * locales — voir l'avertissement en tête de `ui-components.css` pour la raison
 * (les règles d'origine sont ancrées en `position: fixed` sur des ids de page)
 * et pour la dette que cela crée.
 *
 * Pas de Pixi ici, et c'est l'information : ces composants-là n'existent QUE
 * dans le DOM. La translucidité, le flou d'arrière-plan et les ombres portées
 * sont exactement ce que le canvas ne sait pas faire, et c'est pourquoi le
 * chrome est resté du DOM au-dessus du canvas plutôt que d'être dessiné dedans.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Corps des icônes du chrome, recopiés de `apps/demo/index.html`. Même dette
 * que la feuille : ce sont les vraies icônes, dupliquées faute de pouvoir les
 * importer (elles vivent en dur dans le HTML de la démo, pas dans un module). */
const ICONS = {
  search: `
    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`,
  fit: `
    <path d="M2 5.5V3.2A1.2 1.2 0 0 1 3.2 2h2.3M10.5 2h2.3A1.2 1.2 0 0 1 14 3.2v2.3M14 10.5v2.3a1.2 1.2 0 0 1-1.2 1.2h-2.3M5.5 14H3.2A1.2 1.2 0 0 1 2 12.8v-2.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <rect x="5.75" y="5.75" width="4.5" height="4.5" rx="1" fill="currentColor" opacity="0.35" />`,
  graph: `
    <path d="M4.2 4.2 11.8 6M11.8 6 7 12.2M4.2 4.2 7 12.2" fill="none" stroke="currentColor" stroke-width="1.3" />
    <circle cx="4.2" cy="4.2" r="2" fill="currentColor" />
    <circle cx="11.8" cy="6" r="2" fill="currentColor" />
    <circle cx="7" cy="12.2" r="2" fill="currentColor" />`,
  dots: `
    <circle cx="8" cy="3.4" r="1.25" fill="currentColor" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    <circle cx="8" cy="12.6" r="1.25" fill="currentColor" />`,
  close: `<path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`,
  up: `<path d="M4.5 9.5 8 6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`,
  down: `<path d="M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />`,
} as const;

type IconName = keyof typeof ICONS;

// --- Fabriques DOM.

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

/** `innerHTML` sur un littéral figé du module : aucune donnée extérieure ne
 * transite ici, et c'est de loin la façon la plus lisible de garder les tracés
 * SVG identiques à ceux du HTML de la démo — les réécrire en appels
 * `createElementNS` rendrait la prochaine comparaison illisible. */
function icon(name: IconName, className?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  svg.innerHTML = ICONS[name];
  return svg;
}

/**
 * L'ossature d'une section : titre, note, rangée de cases.
 *
 * Les classes sont propres à cette vue (`uic-*`) et non celles des vues Tokens
 * (`ds-*`) ou Composants graphe (`gc-*`) : celles-là vivent dans la feuille
 * d'une AUTRE vue, et s'y appuyer casserait le jour où cette autre vue renomme
 * ou déplace sa feuille, sans que rien ne l'ait annoncé.
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
 * Une case : le spécimen sur damier, sa légende dessous.
 *
 * La légende accepte du balisage léger (`<code>`) parce qu'elle nomme des
 * attributs et des sélecteurs — `disabled`, `aria-busy="true"` — qu'un texte nu
 * ne distinguerait pas de la prose environnante.
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

/** Le socle flottant, sur lequel TOUT le reste repose : dans la démo, aucune de
 * ces primitives n'apparaît jamais à nu sur le canvas. Les composer ici sur
 * autre chose donnerait des couleurs de survol qu'on ne verra jamais. */
function float(className: string | null, ...content: Node[]): HTMLElement {
  const node = el("div", className ? `uic-float ${className}` : "uic-float");
  node.append(...content);
  return node;
}

// --- Section 1 : la surface flottante.

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
      "la grappe d'icônes (<code>.cluster</code>) — la même surface, resserrée à 3px autour de ses boutons, avec son séparateur d'1px.",
      float(
        "uic-cluster",
        iconButton({ icon: "search", label: "Rechercher" }),
        iconButton({ icon: "fit", label: "Ajuster à la vue" }),
        iconButton({ icon: "graph", label: "Vue graphe" }),
        el("span", "uic-cluster-sep"),
        iconButton({ icon: "dots", label: "Menu" }),
      ),
    ),
  );

  return node;
}

// --- Section 2 : le bouton d'icône.

interface IconButtonOptions {
  icon: IconName;
  label: string;
  small?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
}

function iconButton(opts: IconButtonOptions): HTMLButtonElement {
  const button = el("button", opts.small ? "uic-ibtn uic-ibtn-sm" : "uic-ibtn");
  button.type = "button";
  button.setAttribute("aria-label", opts.label);
  button.title = opts.label;
  // `aria-expanded` et `aria-busy` sont posés en ATTRIBUT, jamais en classe :
  // ce sont eux que la feuille sélectionne, exactement comme dans la démo, et
  // c'est ce qui rend impossible un état visuel sans son annonce aux
  // technologies d'assistance.
  if (opts.expanded) button.setAttribute("aria-expanded", "true");
  if (opts.busy) button.setAttribute("aria-busy", "true");
  if (opts.disabled) button.disabled = true;
  button.append(icon(opts.icon));
  return button;
}

/** Un bouton seul, mais sur sa grappe : hors d'une surface flottante, sa teinte
 * de survol (`--float-hover`) se composerait sur le canvas et non sur le verre,
 * donc sur une couleur que le produit ne montre jamais. */
function loneButton(opts: IconButtonOptions): HTMLElement {
  return float("uic-cluster", iconButton(opts));
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
      "variante <code>.ibtn-sm</code> — 24px, la seule autre taille du chrome ; elle ne sert qu'à fermer le panneau de détail. Mêmes états que ci-dessus.",
      loneButton({ icon: "close", label: "Fermer le panneau", small: true }),
    ),
  );

  return node;
}

// --- Section 3 : le champ de recherche.

interface FindbarOptions {
  value?: string;
  counter?: string;
  disabled?: boolean;
}

function findbar(opts: FindbarOptions = {}): HTMLElement {
  const input = el("input", "uic-search");
  input.type = "search";
  input.placeholder = "Rechercher…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Rechercher");
  if (opts.value !== undefined) input.value = opts.value;
  if (opts.disabled) input.disabled = true;

  const nav = (name: "up" | "down", label: string): HTMLButtonElement => {
    const button = el("button", "uic-findbar-nav");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (opts.disabled) button.disabled = true;
    button.append(icon(name));
    return button;
  };

  return float(
    "uic-findbar",
    icon("search", "uic-findbar-icon"),
    input,
    el("span", "uic-match-counter", opts.counter ?? ""),
    nav("up", "Résultat précédent"),
    nav("down", "Résultat suivant"),
  );
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
      "<code>disabled</code> sur le champ et les chevrons — <strong>et c'est un trou</strong> : le chrome de la démo ne définit aucune règle désactivée pour eux. Ce qu'on voit est le style par défaut du navigateur, pas une décision du design system.",
      findbar({ value: "order", counter: "0/0", disabled: true }),
    ),
  );

  return node;
}

// --- Section 4 : la pastille d'entité.

function badgeSample(type: string, label: string): HTMLElement {
  return float(
    "uic-detail-sample",
    el("span", "uic-badge", type),
    el("p", "uic-detail-label", label),
  );
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
      "l'encre est un <code>#ffffff</code> écrit en dur dans le chrome, pas un token — <strong>le design system n'a pas d'encre « sur accent »</strong>. Recopié tel quel ici : y substituer une variable ferait mentir le spécimen sur ce que le produit dessine.",
      badgeSample("Customer", "Customer #c1"),
    ),
  );

  return node;
}

// --- Section 5 : l'item de menu.

interface MenuItemOptions {
  text: string;
  disabled?: boolean;
}

function menuPanel(items: MenuItemOptions[]): HTMLElement {
  // Sans `role="menu"` / `role="menuitem"`, contrairement à la démo : ces rôles
  // promettent une navigation aux flèches que cette planche n'implémente pas.
  // Une promesse d'accessibilité non tenue est pire que son absence, et les
  // rôles ne changent RIEN au visuel examiné ici.
  const panel = float("uic-menu");
  for (const item of items) {
    const button = el("button", "uic-menu-item", item.text);
    button.type = "button";
    if (item.disabled) button.disabled = true;
    panel.append(button);
  }
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

// --- Montage.

/**
 * Monte la vue. Conforme au contrat de `PlaygroundView.mount` : `root` est vide
 * et nous appartient, le retour démonte.
 *
 * Le paramètre `state` du contrat n'est pas déclaré — cette vue n'en a pas
 * besoin. Tout ce qu'elle dessine est habillé par les variables CSS générées,
 * qui suivent `data-theme` sur `<html>` ; le thème arrive donc par la cascade,
 * sans que la vue ait à le lire. C'est aussi ce qui fait d'elle la seule à
 * survivre telle quelle à une bascule de mode — le shell la remonte quand même,
 * par uniformité avec les vues Pixi qui, elles, ne le peuvent pas.
 *
 * Aucune ressource à libérer non plus : ni canvas, ni abonnement, ni écouteur
 * hors de `root`. Le cleanup se borne donc à retirer le sous-arbre.
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
