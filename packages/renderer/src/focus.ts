import type { NodeId, RefEdge } from "@defsquare/data-graph-core";

/**
 * L'opacité d'une carte ou d'une arête SANS lien avec la sélection.
 *
 * 0,25 : assez bas pour que le voisinage de la sélection se détache d'un coup
 * d'œil au milieu de centaines de cartes, assez haut pour que le reste de la
 * mise en page reste lisible — l'estompage est un guide de lecture, pas un
 * masque. Les cartes estompées restent d'ailleurs cliquables : l'alpha ne
 * change rien au hit-testing de Pixi, qui est géométrique.
 *
 * La constante vit ICI, dans un module que rien d'autre ne tire, parce qu'elle
 * est partagée par les trois parts de l'effet : les cartes (`applyFocusDim`,
 * dans `create.ts`), les arêtes et les enveloppes d'agrégats (`drawEdges` et
 * `drawClusters`, dans `draw.ts`). La poser dans l'un des deux obligerait
 * l'autre à l'importer — et `draw.ts` important `create.ts` fermerait un cycle,
 * puisque `create.ts` importe déjà `draw.ts`.
 *
 * Le MÊME facteur partout, et pas un réglage par calque : c'est ce qui fait que
 * l'estompage se lit comme un seul recul du décor, et non comme trois effets
 * qui se ressemblent. Sur une enveloppe il MULTIPLIE des alphas déjà très bas
 * (0,08 de fond), ce qui la fait pratiquement disparaître — c'est voulu : un
 * disque translucide reste visible par son contour, et l'estomper à demi
 * laisserait le regard s'y accrocher.
 */
export const DIM_ALPHA = 0.25;

/**
 * L'ensemble des nœuds à garder à pleine opacité autour de `focusId` : lui-même,
 * les DEUX bouts de ses références (entrantes comme sortantes), son parent de
 * containment et ses enfants directs.
 *
 * `null` en retour signifie « aucun focus », et se lit autrement que l'ensemble
 * vide : vide dirait « personne n'est lié », donc « estompe tout », alors qu'il
 * ne faut alors rien estomper du tout. L'appelant traite les deux cas d'une
 * seule expression (`keep === null || keep.has(id)`), ce qui rend l'absence de
 * sélection impossible à confondre avec une sélection isolée.
 *
 * Le voisinage s'arrête à la DISTANCE 1. Suivre les chaînes plus loin ferait
 * grossir l'ensemble jusqu'à couvrir la plupart du graphe, et un estompage qui
 * ne distingue plus rien ne sert à rien.
 *
 * De la donnée NUE en entrée — un tableau d'arêtes, un parent, des enfants —
 * plutôt que le `Graph` et un `NodeId` : la fonction n'a besoin de rien
 * d'autre, et s'en tenir là la rend testable sans construire de graphe.
 * `to === null` (référence cassée) est ignoré : il n'y a personne au bout.
 */
export function relatedIds(
  refEdges: readonly RefEdge[],
  focusId: NodeId | null,
  parentId: NodeId | null,
  childIds: readonly NodeId[],
): Set<NodeId> | null {
  if (focusId === null) return null;
  const keep = new Set<NodeId>([focusId]);
  if (parentId !== null) keep.add(parentId);
  for (const childId of childIds) keep.add(childId);
  for (const edge of refEdges) {
    if (edge.to === null) continue;
    if (edge.from === focusId) keep.add(edge.to);
    else if (edge.to === focusId) keep.add(edge.from);
  }
  return keep;
}

/**
 * L'ensemble des nœuds à garder à pleine opacité autour d'un AGRÉGAT
 * sélectionné : tous ses membres, plus toute carte extérieure qui a une
 * référence avec l'un d'eux, dans un sens ou dans l'autre.
 *
 * C'est le pendant de `relatedIds` pour l'autre unité de sélection de la vue
 * graphe, et il obéit à la même règle de distance 1 — sauf que la « distance »
 * se compte depuis le BLOC entier et non depuis une carte. L'agrégat étant ce
 * que la vue montre comme un objet, l'estompage doit répondre à la question
 * qu'on lui pose en le désignant : « qui parle à ce bloc ? »
 *
 * Pas de `null` en retour, à la différence de `relatedIds` : on n'appelle ceci
 * que lorsqu'un agrégat EST sélectionné. L'absence de sélection reste portée par
 * l'appelant, qui n'a alors aucune raison d'appeler.
 *
 * Même donnée NUE en entrée : des arêtes et un ensemble d'ids, pas l'index
 * d'agrégats ni le graphe. `to === null` (référence cassée) est ignoré — il n'y
 * a personne au bout, donc personne à garder plein, et une référence cassée
 * n'est de toute façon plus tracée dans l'espace des arêtes : elle se signale
 * sur la carte de sa source.
 */
export function clusterRelatedIds(
  refEdges: readonly RefEdge[],
  memberIds: ReadonlySet<NodeId>,
): Set<NodeId> {
  const keep = new Set<NodeId>(memberIds);
  for (const edge of refEdges) {
    if (edge.to === null) continue;
    if (memberIds.has(edge.from)) keep.add(edge.to);
    else if (memberIds.has(edge.to)) keep.add(edge.from);
  }
  return keep;
}

/**
 * Faut-il estomper l'enveloppe d'un agrégat dont les membres sont `memberIds` ?
 *
 * Oui ssi AUCUN membre n'est dans l'ensemble à garder plein. La règle est celle
 * des cartes, remontée d'un cran : l'enveloppe est le contenant, elle recule
 * quand tout ce qu'elle contient a reculé — et un seul membre lié suffit à la
 * garder pleine, parce qu'elle est alors la seule chose qui montre OÙ ce membre
 * habite. L'enveloppe sélectionnée tombe dans ce cas sans qu'on ait à la traiter
 * à part : ses membres sont, par construction, dans l'ensemble.
 *
 * `keep === null` (pas de sélection) rend `false` : rien à estomper, comme pour
 * les cartes et les arêtes. Même expression que chez les autres lecteurs, pour
 * que l'absence de sélection ne puisse pas se confondre avec une sélection dont
 * l'ensemble serait vide.
 */
export function clusterDimmed(
  keep: ReadonlySet<NodeId> | null,
  memberIds: Iterable<NodeId>,
): boolean {
  if (keep === null) return false;
  for (const id of memberIds) if (keep.has(id)) return false;
  return true;
}
