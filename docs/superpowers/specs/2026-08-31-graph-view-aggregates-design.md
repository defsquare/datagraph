# Vue graphe : entités, références et agrégats

**Statut** : design validé, prêt pour un plan d'implémentation
**Branche** : `feat/graph-view-aggregates`
**Sonde préalable** : `docs/superpowers/spikes/2026-08-31-organic-layout.md`

## Le problème

Le layout actuel met en page l'arbre de containment JSON et **ignore
complètement `refEdges`**. Deux conséquences, mesurées sur le jeu de démo
étendu (2019 nœuds logiques, 227 visibles au repos) :

1. **La géométrie est pilotée par des nœuds qui n'ont pas de sens.** Sur les
   227 nœuds visibles, 224 sont des entités et 3 sont structurels — la racine,
   `customers`, `orders`. Ces 3 nœuds portent à eux seuls 224 des arêtes de
   containment. Ce sont eux qui créent la topologie en étoile, donc
   l'empilement en colonne de `elk.layered` : ratio de bbox 1:21, 2,5 % de
   remplissage, une vue d'ensemble illisible dès ~100 nœuds visibles.
2. **Le sens n'est pas mis en page.** Les 112 arêtes `Order → Customer`, les
   seules qui portent de l'information métier, ne participent à rien.

Le layout actuel met donc en page exactement ce qui n'a pas de sens, et ignore
exactement ce qui en a.

## Ce qu'on construit

Une **seconde vue**, dite « graphe », à côté de la vue structure existante :

- les sommets sont les **entités** et rien d'autre ;
- les arêtes sont les **références** et rien d'autre ;
- les entités sont regroupées en **agrégats** déclarés dans la configuration,
  dessinés comme des enveloppes ; une entité peut appartenir à plusieurs
  agrégats à la fois.

La vue structure actuelle — containment, ELK layered, expand/collapse du JSON —
**n'est pas modifiée**. Les deux vues partagent la sélection.

### Décisions cadrantes

| Décision | Choix retenu |
|---|---|
| Sommets de la vue graphe | Entités seulement ; racine, tableaux et objets imbriqués ne sont pas dessinés |
| Définition d'un cluster | Agrégat déclaré dans la config, pas de détection automatique |
| Périmètre | Deux vues coexistantes, bascule explicite |
| Appartenance multiple | Autorisée : une entité peut être dans plusieurs agrégats |
| Forme des enveloppes | Convexe matelassée (pas de bubble-sets concaves) |
| État initial des agrégats | Dépliés |

## Règle d'appartenance

> Une entité E appartient à l'agrégat de racine R si R fait partie des racines
> que E atteint **à distance minimale**, en suivant les références sortantes.
> Une racine est à distance 0 d'elle-même.

Formellement : soit `d(E, R)` le nombre minimal d'arêtes `refEdge` sortantes
menant de E à R. Soit `dmin(E) = min{ d(E, R) | R racine, d(E, R) fini }`.
Alors E appartient à l'agrégat de R ssi `d(E, R) = dmin(E)`.

Cette règle a trois propriétés voulues :

- **Le chevauchement n'apparaît que là où il est réel.** `Order o3 → Customer c1`
  et `Order o3 → Product p9`, les deux types étant racines : égalité à 1 saut,
  donc o3 appartient aux deux agrégats.
- **Elle est transitive quand il le faut.** `LineItem → Order → Customer` :
  le LineItem rejoint l'agrégat de Customer à 2 sauts.
- **Elle borne l'explosion des hubs sans réglage.** Si `Customer → Country` et
  que Country est aussi racine, une transitivité naïve mettrait tout le monde
  dans l'agrégat Country. Ici non : un Order atteint Customer à 1 saut et
  Country à 2, il reste donc chez Customer. Aucun `maxDepth` à régler à
  l'aveugle.

Cas limites, tous à couvrir par des tests :

- Une racine appartient toujours à son propre agrégat et à lui seul
  (`d(R, R) = 0`, minimal par construction) : une racine n'est jamais absorbée
  par une autre.
- Une entité qui n'atteint aucune racine n'appartient à aucun agrégat. Elle est
  dessinée normalement, sans enveloppe.
- Les `refEdge` cassées (`to === null` ou `dangling`) ne propagent rien.
- Les cycles de références sont coupés par le marquage de visite du BFS.
- Un type déclaré racine dont aucune instance n'existe ne produit aucun agrégat.

## Architecture

Cinq unités nouvelles dans le cœur, chacune testable seule, plus deux
extensions du renderer. Aucune ne modifie le chemin de la vue structure.

### `config.ts` — extension

```ts
export interface DataGraphConfig {
  // … champs existants inchangés
  /** Types d'entités qui sont racines d'agrégat. */
  aggregates?: string[]
}

export interface ValidatedConfig {
  // … champs existants inchangés
  aggregates: string[]   // vide si non fourni ; ordre de déclaration préservé
}
```

`validateConfig` rejette avec `ConfigError("unknown-entity-type", …)` tout nom
qui n'est pas un type d'entité déclaré, comme il le fait déjà pour
`references`. L'ordre de déclaration est conservé : il ne joue aucun rôle dans
l'appartenance (le chevauchement rend tout arbitrage inutile), seulement dans
l'ordre de peinture des enveloppes, pour que le rendu soit reproductible.

### `aggregate.ts` — nouveau

```ts
export interface Aggregate {
  /** `${rootType}#${rootEntityId}` — stable entre deux constructions. */
  id: string
  rootId: NodeId
  rootType: string
  /** Inclut `rootId`. */
  memberIds: Set<NodeId>
}

export interface AggregateIndex {
  aggregates: Map<string, Aggregate>
  /** Plusieurs entrées pour une entité = chevauchement. Ordre stable :
   *  celui de `ValidatedConfig.aggregates`, puis l'id de la racine. */
  byNode: Map<NodeId, string[]>
}

export function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex
```

Implémentation : un BFS **multi-source inverse** sur `refEdges`. On construit
l'adjacence inverse (cible → sources), on initialise la file avec toutes les
racines à distance 0, et on propage. Chaque nœud retient sa distance minimale
et l'ensemble des racines atteintes à cette distance ; une racine découverte à
une distance strictement supérieure à celle déjà connue est ignorée, une
racine à distance égale s'ajoute (c'est ce qui produit le chevauchement).

Un seul parcours pour toutes les racines, donc linéaire en (entités +
références) — pas un BFS par racine.

`buildGraph` n'est **pas** modifié : `refEdges` et `entityIndex` fournissent
déjà tout le nécessaire.

### `hull.ts` — nouveau

```ts
export interface Point { x: number; y: number }
/** Enveloppe convexe des coins des rectangles, chacun gonflé de `padding`. */
export function paddedHull(rects: Rect[], padding: number): Point[]
```

Enveloppe convexe par balayage de Andrew (monotone chain) sur les 4 coins de
chaque rectangle préalablement gonflé. Gonfler *avant* plutôt que décaler le
polygone *après* évite tout calcul d'offset de polygone et reste exact.

Cas limites à tester : un seul rectangle (l'enveloppe est ce rectangle gonflé,
4 points), deux rectangles, des centres colinéaires, des rectangles identiques
superposés, une liste vide (renvoie `[]`).

### `separate.ts` — extrait de la sonde

```ts
export function separateOverlaps(
  positions: Map<NodeId, Rect>,
  margin: number,
  iterations: number,
): void
```

Écarte les rectangles en collision par relaxation, le long de leur axe de
moindre pénétration, chacun encaissant la moitié du déplacement. Voisinage via
une grille de hachage de maille égale à la plus grande carte, donc linéaire.
Déterministe : aucun aléa, ordre d'itération stable.

Cette passe est indispensable et la sonde l'a montré : une force converge vers
un compromis attraction/répulsion, **jamais** vers une contrainte dure de
non-recouvrement. Sans elle, fcose recouvre jusqu'à 94 % de l'aire des cartes ;
avec elle, on tombe à 0 pour un remplissage de ~46 %.

Le code existe déjà sur `spike/organic-layout`, validé par les bancs de mesure.
Il est repris tel quel.

### `layout-graph.ts` — nouveau

```ts
export interface GraphLayoutResult extends LayoutResult {
  clusters: { aggregateId: string; rootId: NodeId; polygon: Point[] }[]
}

export interface GraphLayoutEngine {
  layout(graph, aggregates, visible, metrics?): Promise<GraphLayoutResult>
  // RETIRÉ avec le pli d'agrégat — voir la section « Dépliage » plus bas :
  //   layoutAfterExpand(prev, graph, aggregates, expandedAggId, visible, metrics?)
  //   layoutAfterCollapse(prev, graph, aggregates, collapsedAggId, visible)
}

export interface GraphLayoutOptions {
  /** Marge entre une carte et le bord de l'enveloppe de son agrégat. */
  hullPadding?: number
  /** Marge garantie entre deux cartes par la passe de séparation. */
  separationMargin?: number
  separationIterations?: number
}

export function createGraphLayoutEngine(opts?: GraphLayoutOptions): GraphLayoutEngine
```

C'est une interface **distincte** de `LayoutEngine`, pas une implémentation de
celle-ci : la signature diffère (elle prend l'index d'agrégats, elle rend des
enveloppes) et la vue structure ne doit rien savoir des agrégats.

Le moteur, sur cytoscape + fcose (le couple validé par la sonde) :

1. **Sommets** : `graph.nodes` filtré sur `kind === "entity"`, intersecté avec
   `visible`.
2. **Arêtes** : `graph.refEdges` non cassées, dont les deux extrémités sont
   visibles.
3. **Regroupement : rien de plus que les références.** L'appartenance à un
   agrégat est *définie* par l'accessibilité le long des `refEdges`, donc tout
   membre est déjà relié à sa racine par un chemin de références présent dans
   le layout. Les membres d'un même agrégat se regroupent d'eux-mêmes.

   > **Mesuré, pas supposé.** Une première version ajoutait un nœud-centre
   > invisible par agrégat, relié à chacun de ses membres, pour renforcer le
   > regroupement. La mesure dit l'inverse : le centre ré-encode une information
   > que le graphe porte déjà, et occupe de la place entre les membres mêmes
   > qu'il devait rassembler. Les co-membres finissent **2,2 à 2,4× plus
   > éloignés** à profondeur 1 et 2, pour un gain nul — dans le bruit — sur les
   > fan-outs larges. Le mécanisme a été retiré. Ne pas le réintroduire sans
   > mesure contraire.

   Le chevauchement ne dépend pas de ce mécanisme, et c'est ce qui a permis de
   le retirer : une entité appartenant à deux agrégats est tirée vers ses deux
   racines par ses propres références, et les enveloppes étant calculées par
   agrégat à partir des positions de ses membres, elle tombe dans les deux
   polygones.
4. **Amorçage déterministe** : la position initiale de chaque sommet est
   dérivée d'un hachage de son `NodeId`, projetée sur un disque, et fcose
   tourne avec `randomize: false`. Le placement spectral aléatoire de fcose est
   ainsi court-circuité. La sonde mesurait 1589 px d'écart médian entre deux
   runs identiques ; l'objectif ici est **zéro**, et c'est directement testable.
5. **Séparation** : `separateOverlaps` sur le résultat, puis
   `separateClusters` (ajouté après coup, voir ci-dessous).
   Rappel de calibrage issu de la sonde : les valeurs par défaut de fcose sont
   prévues pour des nœuds ponctuels et inutilisables sur des cartes de
   140–340 px. La longueur d'arête idéale doit être dérivée de la taille des
   deux boîtes reliées, pas laissée à 50 px.
6. **Enveloppes** : `paddedHull` sur les rectangles des membres visibles de
   chaque agrégat, dans l'ordre stable de `ValidatedConfig.aggregates`.

Un agrégat dont aucun membre n'est visible ne produit pas d'enveloppe.

**Point de packaging, à ne pas rater.** Ce module ne doit pas être exporté
depuis `src/index.ts` : le barrel est importé par tout consommateur, donc un
export statique ferait entrer `cytoscape` et `cytoscape-fcose` dans le bundle de
quiconque n'utilise que la vue structure — exactement les +183 ko gzip qu'on
cherche à éviter. `layout-graph.ts` reçoit son **propre point d'entrée** :

```jsonc
// packages/core/package.json
"exports": {
  ".":              { "types": "./dist/index.d.ts",        "import": "./dist/index.js" },
  "./graph-layout": { "types": "./dist/graph-layout.d.ts",  "import": "./dist/graph-layout.js" }
}
```

avec une seconde entrée `tsup`. Le renderer fait alors
`await import("@defsquare/data-graph-core/graph-layout")` à la première bascule
vers la vue graphe. `aggregate.ts` et `hull.ts` n'ont aucune dépendance externe
et restent, eux, dans le barrel principal.

Un test de non-régression doit vérifier que `dist/index.js` ne référence ni
`cytoscape` ni `cytoscape-fcose`.

### `cluster-separate.ts` — ajouté après coup

```ts
export function separateClusters(
  positions: Map<NodeId, Rect>,
  aggregates: AggregateIndex,
  gap: number,
  iterations: number,
): void
```

`separateOverlaps` écarte les CARTES ; elle ne dit rien des AGRÉGATS, et sans
seconde passe les enveloppes se touchent — mesuré sur `bigShop(3000)` : 310
paires d'enveloppes franchement superposées, 0,7 px d'écart moyen au plus
proche voisin. Cette passe-ci reprend la même mécanique de relaxation à la
granularité du cluster : boîte englobante par agrégat, poussée le long de l'axe
de moindre pénétration jusqu'à `clusterGap`, puis **translation rigide** de
chaque membre par le déplacement total de son cluster. C'est la rigidité qui la
rend sûre : la géométrie interne d'un agrégat traverse la passe intacte, et
comme rien ne relance `separateOverlaps` derrière, c'est aussi ce qui garantit
qu'aucun recouvrement de cartes n'y apparaît.

Deux cas particuliers. Une entité sans agrégat forme un cluster d'un seul, pour
être poussée hors des enveloppes voisines. Et **les agrégats qui partagent une
entité fusionnent** en un super-cluster, par union-find, avant la relaxation :
une entité partagée est membre à part entière de chacun de ses agrégats, donc
lui donner un déplacement propre la détacherait de ses co-membres. Des agrégats
tricotés par une entité commune ne se séparent pas sans la déchirer ; ils se
déplacent ensemble, et leurs enveloppes continuent de se croiser.

> **Mesuré, pas supposé.** Une première version donnait à l'entité partagée la
> MOYENNE des translations de ses agrégats, et se contentait d'exempter la
> paire d'agrégats qui la partage. Cette exemption ne protège que d'une poussée
> ENTRE ces deux-là : dès qu'un TIERS cluster pousse l'un des deux, les deux
> déplacements diffèrent, la moyenne détache la carte partagée de ses
> co-membres, et des cartes se recouvrent — reproduit sur un cas à trois
> clusters : distances intra-agrégat 120 → 62,50 px et 60 → 2,50 px, une paire
> de cartes en recouvrement. Aucun fixture du dépôt ne pouvait le voir : tous
> ceux qui ont des membres partagés n'ont que DEUX clusters, tous deux exemptés,
> donc rien ne bougeait. La fusion supprime le cas au lieu de le rattraper, et
> rend moyenne comme exemption inutiles. Une note de garde, à ne pas perdre :
> la boucle de relaxation ne voyait jamais l'entité partagée (boîtes calculées
> avant, moyenne appliquée après), donc retirer l'exemption n'aurait PAS empêché
> la convergence — c'est justement en croyant les deux couplés qu'on a manqué le
> défaut.

**Coût de la fusion, mesuré.** Elle est transitive : A partage avec B, B avec C,
donc les trois n'en font qu'un. Sur une racine unique (le cas du dépôt et de la
démo) il n'y a aucun partage, donc aucune fusion. Sur deux racines dont chaque
commande référence son client ET son produit : 334 agrégats → 167 super-clusters
de 3 cartes, sans effet visible. Mais avec un CATALOGUE partagé, la fusion
dégénère : 20 produits → 20 super-clusters (le plus gros 19 cartes), 3 produits
→ 3 super-clusters (le plus gros 113 cartes, 33 % du graphe), 1 produit → un
seul super-cluster couvrant 100 % du graphe, où la passe ne peut plus rien
écarter. C'est sémantiquement correct — ces agrégats sont réellement inséparables
— mais l'effet pratique est que l'écartement ne s'applique pas à ces données-là.
À savoir avant de compter dessus sur un modèle à hub.

La sortie anticipée compare à une épsilon et non à zéro : elle se déclenche
vraiment, contrairement à celle de `separateOverlaps`.

`clusterGap` vaut 160 px par défaut, **calibré par mesure** — le balayage
complet est dans `DEFAULTS` (`layout-graph.ts`) — et se règle depuis
`createDataGraph` via `graphLayoutOptions`, puisque c'est un réglage d'œil. À NE
PAS refaire en allongeant
`idealEdgeLength` des arêtes inter-agrégats : fcose calibre son échelle de
répulsion sur la MOYENNE des longueurs idéales, donc allonger un sous-ensemble
gonfle toute la mise en page au lieu d'ouvrir les couloirs. C'était déjà essayé
et documenté au point d'appel d'`idealEdgeLength`.

### `aggregate-collapse.ts` — ~~nouveau~~ RETIRÉ

> **Mécanisme retiré.** La vue graphe ne plie plus rien : toutes les entités y
> sont visibles en permanence, aucune carte ne porte de chevron, et un clic
> d'en-tête y sélectionne comme un clic de corps. `aggregate-collapse.ts`, son
> test et son export du barrel ont été supprimés. La section ci-dessous est
> conservée telle quelle comme trace de conception, à la manière de la note sur
> le centre virtuel d'agrégat plus haut : elle décrit du code qui n'existe plus.

```ts
export class AggregateCollapseState {
  constructor(index: AggregateIndex)
  isExpanded(aggregateId: string): boolean
  expand(aggregateId: string): void
  collapse(aggregateId: string): void
  visibleEntityIds(): Set<NodeId>
}
```

Les agrégats démarrent **dépliés** : la vue graphe existe pour montrer le
graphe. Replier un agrégat le réduit à sa seule carte racine.

Règles de visibilité, dans cet ordre :

- une racine d'agrégat est toujours visible ;
- une entité qui n'appartient à aucun agrégat est toujours visible ;
- une entité membre non-racine est visible ssi **au moins un** des agrégats
  auxquels elle appartient est déplié. C'est la règle correcte sous
  chevauchement : une entité partagée reste montrée par celui de ses agrégats
  qui est ouvert, et ne disparaît que quand ils sont tous fermés.

C'est une classe distincte de `CollapseState`, qui reste inchangée et continue
de servir la vue structure.

### Dépliage : épinglage plutôt que relance globale — RETIRÉ

> **Mécanisme retiré**, en même temps que le pli d'agrégat ci-dessus. Sans pli,
> il n'y a plus de dépliage, donc plus aucun relayout incrémental à stabiliser :
> `layoutAfterExpand` et `layoutAfterCollapse` ont disparu de
> `GraphLayoutEngine`, avec le paramètre `pinned` de son `run(...)` interne, le
> câblage de `fixedNodeConstraint` et le saut de normalisation de bbox sous
> épinglage (la normalisation tourne désormais toujours). Les tests
> correspondants et la ligne de budget « dérive médiane » des READMEs sont
> supprimés avec eux : un budget sans test ni code derrière lui vaut moins que
> pas de budget du tout. La section ci-dessous reste comme trace de conception.

C'était le point qui a fait échouer la sonde et il était traité ici de front.

Une force-layout est globale : la sonde mesurait **1084 px de dérive médiane**
(p95 : 2562 px) sur les nœuds déjà présents à chaque dépliage — la carte que
l'utilisateur regardait avait quitté l'écran quand le layout revenait.

`layoutAfterExpand` **épingle** ici toutes les entités déjà positionnées via
`fixedNodeConstraint` de fcose et ne relaxe que les nœuds nouvellement révélés.
Un dépliage n'expose que les membres d'un agrégat, donc une poignée de nœuds :
l'opération est peu coûteuse et la dérive attendue sur les nœuds existants est
**nulle par construction**. `separateOverlaps` tourne ensuite sur l'ensemble et
peut encore bouger un nœud épinglé s'il se fait mordre — c'est voulu, et borné
par la marge.

`layoutAfterCollapse` est synchrone (comme dans `LayoutEngine`) : il retire les
nœuds devenus invisibles, recalcule les enveloppes sur les membres restants, et
ne relance aucune force. Le trou laissé ne se referme pas jusqu'au prochain
dépliage — comportement accepté, cohérent avec l'épinglage.

### Renderer

```ts
export type DataGraphView = "structure" | "graph"

export interface DataGraphOptions {
  // … champs existants inchangés
  view?: DataGraphView   // défaut "structure"
}

export interface DataGraph {
  // … méthodes existantes inchangées
  setView(view: DataGraphView): Promise<void>
  currentView(): DataGraphView
}
```

Un calque `hullsGraphics` s'insère **sous** `edgesGraphics` dans
`world.addChild(...)` (`create.ts:179`), pour que les enveloppes passent
derrière tout le reste. Les enveloppes sont peintes en remplissage translucide
plus contour, dans la couleur d'accent du type de leur racine, obtenue via
`entityAccentMap` qui existe déjà.

En vue graphe, les références deviennent les arêtes **principales** : elles sont
tracées pleines, et non avec le pointillé « référence » de la vue structure, où
elles sont une décoration au-dessus du containment.

`fit()` doit englober les enveloppes, pas seulement les cartes : la marge
déborde des rectangles.

**Sélection partagée.** Basculer de vue conserve l'id sélectionné. Si le nœud
sélectionné n'est pas une entité (on quitte la vue structure depuis un objet
imbriqué), la vue graphe sélectionne son **ancêtre entité le plus proche**, en
remontant `parentId` ; s'il n'y en a pas, la sélection est vidée.

Le thème et les polices ne changent pas : `setTheme` et les `NodeMetrics`
restent partagés entre les deux vues, avec les mêmes garanties qu'aujourd'hui.

### Démo

- Un bouton de bascule Structure / Graphe.
- `shopConfig` gagne `aggregates: ["Customer"]`.
- **`bigShop` doit changer.** Il génère aujourd'hui exactement une commande par
  client (`customerId: c${i}`), donc des agrégats de deux cartes où le
  clustering est invisible. Il faut 2 à 4 commandes par client. C'est une
  modification de fixture de démo, pas du cœur ; `packages/core/test/fixtures.ts`
  documente déjà que la duplication est volontaire, il faudra les resynchroniser
  à la main.

## Tests

Le cœur est testable sans rendu, et c'est là que porte l'essentiel.

**`aggregate.test.ts`** — la règle d'appartenance, cas par cas : appartenance
simple à 1 saut ; transitivité à 2 sauts ; égalité de distance produisant un
chevauchement ; racine jamais absorbée par une autre racine ; hub borné (le cas
`Customer → Country` décrit plus haut) ; entité n'atteignant aucune racine ;
référence cassée ne propageant rien ; cycle de références ; type racine sans
instance ; ordre stable de `byNode`.

**`hull.test.ts`** — enveloppe convexe : cas nominal, un seul rectangle, deux
rectangles, centres colinéaires, rectangles superposés identiques, liste vide.
Invariant vérifié systématiquement : tout coin de tout rectangle d'entrée est à
l'intérieur ou sur le bord du polygone rendu.

**`separate.test.ts`** — reprise des tests de la sonde : deux rectangles qui se
mordent finissent séparés d'au moins la marge ; une configuration déjà
disjointe n'est pas modifiée ; le résultat est identique sur deux exécutions.

**`layout-graph.test.ts`** — aucun nœud non-entité dans le résultat ; aucun id
préfixé `__agg:` dans le résultat ; **déterminisme : deux `layout()` sur les
mêmes entrées donnent des positions identiques au pixel** ; aucun chevauchement
de cartes après la passe de séparation ; chaque enveloppe contient tous les
rectangles de ses membres visibles ; un agrégat sans membre visible ne produit
pas d'enveloppe. ~~**`layoutAfterExpand` laisse les positions des nœuds déjà
présents inchangées**~~ — RETIRÉ avec le pli d'agrégat.

~~**`aggregate-collapse.test.ts`**~~ — RETIRÉ avec le pli d'agrégat : état
initial déplié ; replier réduit à la racine ; une entité partagée reste visible
tant qu'un de ses agrégats est déplié et disparaît quand tous sont repliés ; une
entité sans agrégat est toujours visible.

**Renderer** — bascule de vue ; report de sélection vers l'ancêtre entité ;
`fit()` englobant les enveloppes.

**E2E** — la vue graphe s'affiche sur le jeu de démo étendu ; le déterminisme
permet enfin de s'appuyer sur des positions, ce que la sonde interdisait.

## Budgets

Repères mesurés par la sonde, sur ~800 sommets, à confirmer sur le graphe
d'entités qui est plus petit et bien moins dense :

| | valeur attendue |
|---|---|
| Ratio de bbox | ~1:1,5 (contre 1:21 aujourd'hui) |
| ~~Remplissage~~ | RÉVISÉ : ~43 % atteint sans écartement des clusters, mais **7,9 %** au `clusterGap` de 160 px — prix assumé de l'écartement demandé, `fit()` recadrant de toute façon |
| Chevauchement de cartes | 0 |
| `layout()` initial | < 3 s à 1000 entités |
| Écart entre deux runs identiques | **0 px** (exigence, pas budget) |
| ~~Dérive au dépliage, nœuds existants~~ | RETIRÉ : sans pli d'agrégat, il n'y a plus de dépliage |

Le poids du bundle est le coût connu : la sonde mesurait **+183 ko gzip** pour
`cytoscape` + `cytoscape-fcose`. Le moteur de la vue graphe doit donc être en
**import dynamique**, chargé à la première bascule et pas dans le chemin par
défaut — la vue structure ne doit rien payer.

## Hors périmètre

- **Layout à deux niveaux** (placer les agrégats entre eux, puis leur contenu).
  C'est l'évolution prévue si la taille l'exige : elle change le moteur sans
  toucher au modèle ni au rendu, puisque les enveloppes sont calculées après
  coup dans les deux cas.
- **Enveloppes concaves** type bubble-sets.
- **Détection automatique de communautés** : écartée au profit des agrégats
  déclarés, pour le déterminisme et parce que la notion DDD est celle que la
  bibliothèque revendique déjà.
- **Recherche et diagnostics conscients des agrégats.**
- **Participation des `refEdge` au layout de la vue structure** : sondé,
  fonctionnel, mais coûteux (7,7 s contre 2,4 s à 800 nœuds) et non décisif.
