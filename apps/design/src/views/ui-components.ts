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
 * La vue « Composants UI » : les primitives du chrome DOM — surface flottante,
 * bouton d'icône, champ de recherche, pastille d'entité, item de menu — chacune
 * déclinée en rangée d'états.
 *
 * Ces spécimens sont les COMPOSANTS EUX-MÊMES. Ils sortent des fabriques de
 * `@defsquare/data-graph-chrome`, celles que la démo appelle, et sont habillés
 * par la feuille que la démo charge. C'est le même régime que la planche des
 * composants graphe vis-à-vis de `draw.ts` : un spécimen ne peut pas mentir sur
 * ce que le produit dessine, parce qu'il EST ce que le produit dessine.
 *
 * Cette planche a d'ailleurs commencé par recopier le CSS et les icônes du
 * chrome, faute de pouvoir les importer — c'est ce constat qui a fait extraire
 * le paquet. Il ne reste ici que le cartel autour des objets exposés.
 *
 * Deux partis pris fondent la planche elle-même.
 *
 * 1. Les états sont RÉELS, jamais simulés. Une case « survol » est le vrai
 *    composant, qu'on survole ; une case « focus » est le vrai composant, qu'on
 *    atteint au Tab. Aucune classe jumelle du genre `.is-hover` : elle ne
 *    serait qu'une copie de la règle `:hover`, et deviendrait fausse dès la
 *    première retouche. Corollaire assumé : plusieurs cases se ressemblent au
 *    repos, et c'est la LÉGENDE qui dit le geste à faire.
 *
 * 2. Les états qui n'existent pas sont DITS absents, pas inventés. Le chrome ne
 *    définit ni `:active` pour l'item de menu, ni `:disabled` pour les chevrons
 *    de la recherche : la planche le montre tel quel et le nomme. Une planche de
 *    design system doit pouvoir servir à repérer un trou ; elle ne le peut pas
 *    si elle le rebouche en passant.
 *
 * Pas de Pixi ici, et c'est l'information : ces composants-là n'existent QUE
 * dans le DOM. La translucidité, le flou d'arrière-plan et les ombres portées
 * sont exactement ce que le canvas ne sait pas faire, et c'est pourquoi le
 * chrome est resté du DOM au-dessus du canvas plutôt que d'être dessiné dedans.
 */

// --- Fabriques DOM du cartel.

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

/** Une surface flottante nue. `.float` est une classe qu'on POSE, pas un
 * composant qu'on construit : elle vient de la feuille du chrome, il n'y a rien
 * à fabriquer. */
function float(extraClass: string | null, ...content: Node[]): HTMLElement {
  const node = el("div", extraClass ? `float ${extraClass}` : "float");
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

// --- Section 2 : le bouton d'icône.

interface SpecimenButtonOptions {
  icon: IconName;
  label: string;
  small?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
}

/**
 * Un bouton du produit, posé dans l'état qu'on veut montrer.
 *
 * `disabled` et `aria-busy` ne sont pas des options de `createIconButton` et ne
 * doivent pas l'être : ce sont des états d'EXÉCUTION, que l'application pose et
 * retire au fil de ce qu'elle fait — une fabrique qui les prendrait en argument
 * suggérerait qu'ils se décident à la construction. La planche les pose donc
 * comme la démo les pose, par attribut, après coup.
 */
function specimenButton(opts: SpecimenButtonOptions): HTMLButtonElement {
  const button = createIconButton({
    icon: opts.icon,
    label: opts.label,
    small: opts.small,
    // `aria-expanded` EST un argument de la fabrique : un déclencheur de panneau
    // le porte dès sa construction, replié, sans quoi il annoncerait un panneau
    // qu'il n'ouvre pas.
    expanded: opts.expanded,
  });
  if (opts.busy) button.setAttribute("aria-busy", "true");
  if (opts.disabled) button.disabled = true;
  return button;
}

/** Un bouton seul, mais sur sa grappe : hors d'une surface flottante, sa teinte
 * de survol (`--float-hover`) se composerait sur le canvas et non sur le verre,
 * donc sur une couleur que le produit ne montre jamais. */
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

// --- Section 3 : le champ de recherche.

interface FindbarSpecimenOptions {
  value?: string;
  counter?: string;
  disabled?: boolean;
}

function findbar(opts: FindbarSpecimenOptions = {}): HTMLElement {
  const bar = createFindbar();
  // La fabrique la rend REPLIÉE, comme la démo en a besoin : dans le produit,
  // la recherche n'apparaît qu'au clic sur la loupe. Sur la planche elle est
  // l'objet exposé, donc dépliée en permanence.
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

// --- Section 4 : la pastille d'entité.

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

// --- Section 5 : l'item de menu.

interface MenuItemSpecimen {
  text: string;
  disabled?: boolean;
}

/**
 * Le panneau de menu du produit, déplié.
 *
 * `createMenu` pose `role="menu"` et `hidden`, comme la démo en a besoin. La
 * planche retire `hidden` — le panneau est ici l'objet exposé — mais garde le
 * rôle : la planche montre le composant tel qu'il est, y compris son ARIA. Ce
 * rôle promet une navigation aux flèches que ni la démo ni la planche
 * n'implémentent ; c'est un écart du produit, et le masquer ici reviendrait à
 * ce que cette planche existe précisément pour empêcher.
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
