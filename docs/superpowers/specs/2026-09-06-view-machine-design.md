# Extraction de la machine à deux vues de `create.ts` — design

Date : 2026-09-06. État de référence : `ae0495e` (`create.ts` = 2166 lignes).
Suite du plan de l'audit d'architecture (phases 1–4 livrées) ; ce document
couvre le morceau structurel volontairement différé en phase 3.

## Le problème, relu sur le code réel

L'audit comptait « `view === "graph"` testé à 15+ endroits ». La relecture
post-phase-3 précise le diagnostic : il y a **18 sites**, mais ils se
répartissent en trois familles très inégales.

1. **Des branches d'une ligne, asymétriques** (≈10 sites) : `hasChevron`,
   `expanded`, `expandedArrays` dans `rebuild()`, le mode d'arêtes
   `"ref"`/`"contain"` dans `redrawEdges`/`redrawOverlay`, l'inertie
   d'`animatePositions`, les gardes de `handleNodeTap`. Chacune est triviale ;
   leur seul défaut est d'être éparpillées.
2. **L'état de la vue graphe et son cycle de vie** (≈350 lignes) :
   `aggregateIndex` / `graphLayout` / `graphEngine` / `graphHullPadding`,
   `ensureGraphEngine` (import dynamique + `TWO_LEVEL_LAYOUT_DEFAULTS`),
   `computeGraphView` / `tryComputeGraphView` / `publishGraphView`,
   l'invalidation dans `doSetData`, plus les lectures dérivées
   (`selectedAggregate`, `clustersFor`, les bornes de `doFit`, le recalcul de
   cercle de `dragCard`). C'est la vraie masse.
3. **L'orchestration inter-vues** (3 sites) : `setView` (report de sélection,
   garde de génération), la branche de `doFocus`, les recalculs de
   `ready`/`doSetData`. Elle coordonne de l'état qui **traverse** les vues
   (`opGen`, `selection`, `collapseState`) et n'appartient à aucune des deux.

## Décision : pas de polymorphisme de vue

L'option « interface `ViewStrategy` à deux implémentations » est **rejetée**.
Les branches ne sont pas symétriques : presque chaque conditionnelle est « la
vue graphe ajoute quelque chose » (enveloppes, disques) ou « la vue structure
ajoute quelque chose » (chevrons, pli, jetons). Une interface commune aurait
~15 méthodes dont la moitié serait des no-ops dans une des deux
implémentations — un miroir des conditionnelles, avec une indirection en plus,
sans toucher au vrai problème, qui est la **synchronisation d'état** (le
quintuple `graph`/`view`/`layoutResult`/`graphLayout`/`collapseState` sous
`opGen`).

Le design retenu suit le motif déjà éprouvé en phase 3C (`search.ts`,
`animate.ts`) : **un contrôleur à dépendances injectées pour l'état, de la
donnée pour les branches, et l'orchestration qui reste où elle est.**

## Les trois mouvements

### M1 — `ViewPolicy` : les branches pures deviennent une donnée

Un objet dérivé de `view`, calculé en tête de `rebuild()` (et lu par
`redrawEdges`/`redrawOverlay` via une fonction `viewPolicy()`) :

```ts
/** Ce que la vue courante permet aux cartes et aux arêtes. Donnée pure,
 * dérivée de `view` seul : la calculer d'un bloc remplace les ternaires
 * éparpillés, et un futur troisième mode de vue s'écrirait ici. */
interface ViewPolicy {
  edgeMode: "ref" | "contain";    // redrawEdges, redrawOverlay
  chevrons: boolean;              // rebuild : en-têtes pliables
  foldable: boolean;              // handleNodeTap : en-tête et jetons plient
  tokenHover: boolean;            // rebuild : survol des jetons de tableau
  expandedArrays: boolean;        // rebuild : chevrons de jetons orientés
}
```

Portée : ~10 ternaires remplacés par des lectures nommées. Aucun état, aucun
module — une fonction locale de `create.ts`. `activePositions`/`activeVisible`
ne rentrent **pas** dedans : elles lisent de l'état, pas une politique.

### M2 — `graph-view.ts` : le contrôleur de l'état de la vue graphe

Nouveau module du renderer, sur le motif de `search.ts` : il possède l'état,
`create.ts` lui fournit ses points de contact. **Aucun import de Pixi** — le
contrôleur est une machine de données, testable sans canvas.

```ts
interface GraphViewHooks {
  /** Options passées à createTwoLevelLayoutEngine au premier chargement. */
  layoutOptions: TwoLevelLayoutOptions | undefined;
  getMetrics(): NodeMetrics;
}

interface GraphViewController {
  /** Calcule SANS publier. L'appelant garde sa garde de génération entre
   * compute et publish — exactement la discipline actuelle. */
  compute(target: Graph, config: DataGraphConfig, reuse: boolean): Promise<GraphViewState>;
  /** compute + repli : null au lieu de propager, warn avec le contexte. */
  tryCompute(target, config, reuse, context: string): Promise<GraphViewState | null>;
  publish(state: GraphViewState): void;
  /** doSetData : index et layout tombent ENSEMBLE, avant re-publication. */
  invalidate(): void;

  positions(): Map<NodeId, Rect> | undefined;         // ex graphLayout?.positions
  entityIds(target: Graph): Set<NodeId>;              // ex entityIdsOf
  clusters(): ClusterShape[];                         // pour les zones de saisie
  aggregateOf(aggregateId: string): Aggregate | undefined;  // ex selectedAggregate, résolu contre l'index courant
  memberIdsContaining(id: NodeId): { cluster: ClusterShape; memberIds: Set<NodeId> } | undefined; // pour dragCard
  hullPadding(): number;                              // ex graphHullPadding
  /** Étend `bounds` EN PLACE aux disques — la contribution de doFit. */
  extendBoundsToClusters(bounds: Rect): void;
  /** La donnée nue de drawClusters : couleurs/estompage/survol résolus ici,
   * survol et sélection fournis par l'appelant (état d'interface). */
  clustersFor(args: {
    graph: Graph;
    accentFor(node: GraphNode): string;
    fallbackColor: string;
    selectedAggregateId: string | null;
    keep: Set<NodeId> | null;
    hoverOf(aggregateId: string): number;
  }): ClusterPaint[];
}
```

Ce qui déménage : `aggregateIndex`, `graphLayout`, `graphEngine`,
`graphHullPadding`, `ensureGraphEngine` (l'`import()` dynamique **déménage avec
lui**), `buildAggregateState`, `entityIdsOf`, `computeGraphView`,
`tryComputeGraphView`, `publishGraphView`, le corps de `clustersFor`, la boucle
de disques de `doFit`, la recherche d'agrégat de `dragCard`.

Ce qui reste dans `create.ts`, volontairement :

- **`opGen` et toutes les gardes de génération.** La course traverse les vues
  (commentaire de `doExpand`) ; le compteur appartient à l'orchestrateur. La
  séparation compute/publish du contrôleur est précisément ce qui le permet.
- **`selection` et `Selection`.** La sélection nodale existe dans les deux
  vues ; seul `aggregateOf` (résolution contre l'index courant) est fourni par
  le contrôleur.
- **`clusterHover`** : état d'interface, alimenté par les handlers Pixi ;
  passé à `clustersFor` par le hook `hoverOf`.
- **`redrawClusterHitAreas`, `dragCluster`, tout le câblage
  `attachDrag`/`attachTap`/`attachHover`** : c'est de la scène Pixi, pas de
  l'état de vue. Ces fonctions maigrissent (elles consomment `clusters()` et
  `aggregateOf`) mais ne bougent pas.
- **`view` elle-même**, `setView`, la branche de `doFocus`, `handleNodeTap` :
  l'orchestration inter-vues.

### M3 — Les invariants du contrat, écrits et testés

Le contrôleur rend enfin testables sans instance Pixi trois invariants
aujourd'hui implicites :

1. **Publication atomique** : `index` et `layout` décrivent toujours le même
   graphe (`publish` d'un bloc, `invalidate` d'un bloc).
2. **`compute` ne publie jamais** : deux `compute` entrelacés puis un seul
   `publish` laissent l'état du publié, pas du dernier terminé.
3. **`hullPadding` n'est juste qu'après le premier chargement** — documenté
   aujourd'hui, asserté demain (0 avant, valeur du moteur après).

Nouveau `test/graph-view.test.ts` (renderer) sur ces trois points +
`clustersFor` (règles d'estompage/survol, aujourd'hui seulement atteignables
par l'e2e).

## Points de vigilance

- **Pureté de bundle.** L'`import()` dynamique et la lecture de
  `TWO_LEVEL_LAYOUT_DEFAULTS` déménagent dans `graph-view.ts` ; les imports
  statiques du point d'entrée `./graph-layout` y restent type-only. Le
  `bundle-purity.test.ts` du renderer garde aujourd'hui ces lignes **dans
  `create.ts`** : il doit suivre le déménagement. C'est une modification de
  test volontaire et assumée — la seule du chantier.
- **Les trois politiques de repli restent aux points d'appel.** `ready`
  retombe en vue structure, `doSetData` invalide puis retombe, `setView`
  renonce sans bouger `view`. Le contrôleur rend `null`, il ne décide pas.
- **`doSetData`** : la séquence `invalidate()` → `if (échec) view = "structure"`
  → `publish(nouveau)` reste un bloc synchrone après la garde de génération,
  dans cet ordre.
- **`api-surface.test.ts`** ne bouge pas : rien de nouveau n'est exporté par
  `index.ts`.

## Étapes de livraison

Chaque étape laisse la suite verte (`pnpm typecheck`, `pnpm build` puis
`pnpm test`, `pnpm --filter demo e2e` — `view.spec.ts` couvre les courses
`setData`/`setView`) et se commite seule.

1. **M1** — `ViewPolicy`, mécanique, comportement identique.
2. **M2a** — le contrôleur : état + cycle de vie (`compute`/`publish`/
   `invalidate`/`positions`/`entityIds`), `create.ts` délègue ; le test de
   pureté suit l'import.
3. **M2b** — les lectures dérivées (`clustersFor`, `aggregateOf`,
   `memberIdsContaining`, `extendBoundsToClusters`, `hullPadding`).
4. **M3** — `test/graph-view.test.ts` (additif).

Résultat attendu : `create.ts` ≈ 1750–1800 lignes, un propriétaire unique pour
l'état de la vue graphe, et le fil `view === "graph"` réduit à l'orchestration
et aux lectures de politique — les seuls endroits où il dit encore quelque
chose.
