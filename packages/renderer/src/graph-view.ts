import {
  buildAggregates,
  validateConfig,
  type AggregateIndex,
  type DataGraphConfig,
  type Graph,
  type NodeId,
  type NodeMetrics,
  type Rect,
} from "@defsquare/data-graph-core";
// `import type` UNIQUEMENT : ce point d'entrée porte la vue graphe et ne doit
// entrer dans le bundle que de qui y bascule réellement. Un import de type ne
// produit aucun code à l'exécution ; le seul chemin d'exécution vers le moteur
// est l'`import()` dynamique d'`ensureEngine`, plus bas dans CE fichier.
// `test/bundle-purity.test.ts` (côté renderer) garde ces deux lignes : le test
// du cœur ne couvre que le `dist/` du cœur, pas ce fichier-ci.
//
// Ce que ces deux lignes valent a changé d'échelle depuis le retrait de
// l'ancien moteur : 2,64 ko gzip au lieu de 180,28. Elles restent parce
// qu'elles tiennent la FORME — la vue graphe se charge à la demande par
// construction — et non plus parce qu'elles tiennent un poids. Le raisonnement
// complet est dans les deux tests de pureté.
import type {
  ClusterShape,
  GraphLayoutEngine,
  GraphLayoutResult,
  TwoLevelLayoutOptions,
} from "@defsquare/data-graph-core/graph-layout";

/** L'état complet de la vue graphe, calculé d'un bloc puis publié d'un bloc :
 * l'index et la mise en page doivent toujours décrire le même graphe. */
export interface GraphViewState {
  index: AggregateIndex;
  layout: GraphLayoutResult;
}

export interface GraphViewHooks {
  /**
   * Les réglages passés à `createTwoLevelLayoutEngine` au PREMIER chargement du
   * moteur. Une valeur simple et non un accesseur : le contrat public
   * (`DataGraphOptions.graphLayoutOptions`) dit déjà que ces valeurs sont lues
   * au premier passage en vue graphe et qu'en changer demande de recréer
   * l'instance.
   */
  layoutOptions: TwoLevelLayoutOptions | undefined;
  /**
   * Les métriques de carte COURANTES, relues à chaque mise en page et non
   * capturées à la construction. C'est une contrainte réelle : le contrôleur est
   * construit avec l'instance, alors que les métriques ne sont mesurées qu'après
   * `fontsReady` dans `ready` — les capturer figerait les valeurs par défaut
   * pour toute la session, et la vue graphe mettrait en page des cartes d'une
   * autre taille que celles qui sont peintes.
   */
  getMetrics(): NodeMetrics;
}

export interface GraphViewController {
  /**
   * Calcule l'état de la vue graphe pour `target` **sans rien publier** :
   * l'appelant garde sa garde de génération entre `compute` et `publish`, ce qui
   * est exactement la discipline en vigueur. Sans cette séparation, un calcul
   * lancé avant un `setData` et terminé après lui écraserait la mise en page du
   * nouveau graphe par des positions calculées sur l'ancien — voire appellerait
   * `layout()` sur une paire (graphe, index) dépareillée.
   *
   * `reuse` conserve l'index en place, qui ne dépend que du couple (graphe,
   * config) et n'a donc pas à être recalculé d'une bascule de vue à l'autre ;
   * un changement de données passe `false`, l'index étant indexé par id de
   * nœud.
   */
  compute(target: Graph, config: DataGraphConfig, reuse: boolean): Promise<GraphViewState>;
  /**
   * `compute` avec son repli : un échec rend `null` au lieu de propager. Les
   * trois appelants partagent la même règle — le moteur de la vue graphe est
   * chargé dynamiquement, donc un import qui échoue ne doit jamais rejeter
   * l'opération englobante — mais ce qu'ils FONT du `null` diffère (retomber en
   * vue structure, ou renoncer à la bascule) et reste donc au point d'appel,
   * comme les gardes de génération : le contrôleur rend `null`, il ne décide
   * pas.
   *
   * `context` n'est là que pour le débogage : il garde à chaque site son message
   * d'avertissement d'origine.
   */
  tryCompute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
    context: string,
  ): Promise<GraphViewState | null>;
  /** Publie en un seul geste l'état calculé par `compute`. */
  publish(state: GraphViewState): void;
  /** Index et mise en page tombent ENSEMBLE : ils sont indexés par id de nœud et
   * ne survivent pas à un changement de données. Les invalider séparément
   * laisserait un couple dépareillé le temps d'une instruction. */
  invalidate(): void;

  /** Les positions publiées, `undefined` tant que rien ne l'a été. */
  positions(): Map<NodeId, Rect> | undefined;
  /** Toutes les entités de `target` : c'est exactement ce que montre la vue
   * graphe, qui ne cache rien. Ne dépend d'aucun état publié — un appelant peut
   * l'interroger avant même le premier calcul. */
  entityIds(target: Graph): Set<NodeId>;
  /** Les enveloppes publiées, ou un tableau vide. Le tableau est celui du
   * moteur, RENDU TEL QUEL et non recopié : c'est en mutant ces formes en place
   * qu'un déplacement de carte ou d'agrégat met les disques à jour. */
  clusters(): ClusterShape[];
  /** L'index publié, ou `undefined`.
   *
   * Accesseur BRUT, provisoire : affiné en M2b, où `aggregateOf` /
   * `memberIdsContaining` / `clustersFor` prendront la place des lectures
   * directes qui passent aujourd'hui par ici. */
  index(): AggregateIndex | undefined;
  /**
   * La marge d'enveloppe EFFECTIVE — celle avec laquelle le moteur a calculé les
   * disques, et donc la seule avec laquelle on ait le droit de les recalculer
   * quand une carte bouge.
   *
   * Vaut 0 tant que le moteur n'a pas été chargé, et c'est sans conséquence :
   * il n'y a de disques à recalculer qu'en vue graphe, c'est-à-dire exactement
   * quand le moteur est déjà là.
   */
  hullPadding(): number;
}

/**
 * L'état de la VUE GRAPHE d'une instance, et son cycle de vie : l'index
 * d'agrégats, la mise en page, le moteur chargé à la demande et la marge
 * d'enveloppe qui en sort. Le contrôleur en est le seul propriétaire.
 *
 * Aucun import de Pixi, ici ni transitivement : c'est une machine de données,
 * testable sans canvas ni instance — même forme que `search.ts` et `animate.ts`,
 * et pour la même raison.
 *
 * Ce qui reste chez l'appelant, volontairement : `opGen` et toutes les gardes de
 * génération (la course traverse les deux vues, le compteur appartient à
 * l'orchestrateur — la séparation `compute`/`publish` est précisément ce qui le
 * permet), les trois politiques de repli sur un `null`, et la vue courante
 * elle-même.
 */
export function createGraphViewController(hooks: GraphViewHooks): GraphViewController {
  // Tout reste `undefined` tant qu'on n'a pas basculé en vue graphe au moins une
  // fois : un consommateur de la seule vue structure ne paie ni le calcul des
  // agrégats ni le chargement du moteur.
  let aggregateIndex: AggregateIndex | undefined;
  let graphLayout: GraphLayoutResult | undefined;
  let graphEngine: GraphLayoutEngine | undefined;
  // Renseignée en même temps que le moteur, dont elle sort : le défaut vient du
  // cœur (voir `ensureEngine`), jamais d'une copie locale du nombre.
  let graphHullPadding = 0;

  // Partagé plutôt qu'alloué à chaque lecture : `clusters()` est appelé à chaque
  // repeint, donc à chaque image d'un déplacement, et le cas « rien de publié »
  // n'a rien à distinguer d'un appel à l'autre.
  const NO_CLUSTERS: ClusterShape[] = [];

  /**
   * Charge le moteur de la vue graphe à la demande.
   *
   * C'est `createTwoLevelLayoutEngine` — packing en étagères intra-agrégat,
   * puis simulation sur les agrégats devenus disques rigides —, et c'est le
   * seul depuis le retrait de `createGraphLayoutEngine` (fcose +
   * `separateOverlaps` + `separateClusters`) et de `cytoscape` avec lui. La
   * sonde qui a motivé la bascule le mesurait ×11 à ×65 plus rapide et ×2 à
   * ×5,4 plus dense, à garanties égales :
   * `docs/superpowers/spikes/2026-09-01-two-level-layout.md`. Mesuré dans
   * Chromium via l'e2e, sur le jeu étendu de la démo : `setView("graph")` est
   * passé de 4 310–4 484 ms à 220–252 ms.
   *
   * L'`import()` reste dynamique. Le chunk qu'émet le build Vite de production
   * d'`apps/demo` ne pèse plus que **2,64 ko gzip** (5,76 ko bruts, contre
   * 180,28 / 577,17 avant le retrait), donc ce n'est plus le poids qui justifie
   * la paresse : c'est qu'elle est la forme par défaut de cette vue, et que
   * `setView` est asynchrone pour cette raison. Les deux tests de pureté de
   * bundle portent le raisonnement complet.
   */
  async function ensureEngine(): Promise<GraphLayoutEngine> {
    if (!graphEngine) {
      const mod = await import("@defsquare/data-graph-core/graph-layout");
      graphEngine = mod.createTwoLevelLayoutEngine(hooks.layoutOptions);
      // C'est ici, et NULLE PART ailleurs, qu'on apprend la marge d'enveloppe
      // par défaut : le namespace du module chargé la porte, donc le renderer
      // la connaît sans en garder de copie et sans importer statiquement ce
      // point d'entrée — ce que les deux tests de pureté interdisent. Le
      // déplacement d'une carte en a besoin pour recalculer les disques comme
      // le moteur les a calculés, et il n'y a de disques qu'en vue graphe,
      // c'est-à-dire exactement quand ce module est déjà chargé.
      graphHullPadding = hooks.layoutOptions?.hullPadding ?? mod.TWO_LEVEL_LAYOUT_DEFAULTS.hullPadding;
    }
    return graphEngine;
  }

  /** Index d'agrégats pour `target`. */
  function buildAggregateState(target: Graph, config: DataGraphConfig): { index: AggregateIndex } {
    return { index: buildAggregates(target, validateConfig(config)) };
  }

  function entityIdsOf(target: Graph): Set<NodeId> {
    const ids = new Set<NodeId>();
    for (const node of target.nodes.values()) {
      if (node.kind === "entity") ids.add(node.id);
    }
    return ids;
  }

  // Nommée plutôt que méthode de l'objet rendu, et appelée telle quelle par
  // `tryCompute` : passer par `this` ferait dépendre le repli de la façon dont
  // l'appelant a obtenu la méthode (un `const { tryCompute } = controller`
  // suffirait à le casser).
  async function compute(
    target: Graph,
    config: DataGraphConfig,
    reuse: boolean,
  ): Promise<GraphViewState> {
    const base = reuse && aggregateIndex ? { index: aggregateIndex } : buildAggregateState(target, config);
    // Pas `engine` tout court à l'appel : chez l'appelant ce nom désigne le
    // moteur ELK de la vue structure, et les deux ne doivent pas se confondre.
    const twoLevelEngine = await ensureEngine();
    const layout = await twoLevelEngine.layout(
      target,
      base.index,
      entityIdsOf(target),
      hooks.getMetrics(),
    );
    return { ...base, layout };
  }

  return {
    compute,

    async tryCompute(
      target: Graph,
      config: DataGraphConfig,
      reuse: boolean,
      context: string,
    ): Promise<GraphViewState | null> {
      try {
        return await compute(target, config, reuse);
      } catch (err) {
        console.warn(`[data-graph] ${context}`, err);
        return null;
      }
    },

    publish(state: GraphViewState): void {
      aggregateIndex = state.index;
      graphLayout = state.layout;
    },

    invalidate(): void {
      aggregateIndex = undefined;
      graphLayout = undefined;
    },

    positions(): Map<NodeId, Rect> | undefined {
      return graphLayout?.positions;
    },

    // L'index d'agrégats ne connaît que les entités rattachées à un agrégat,
    // donc on balaie le graphe et pas l'index — sans quoi une entité isolée
    // disparaîtrait de la vue.
    entityIds: entityIdsOf,

    clusters(): ClusterShape[] {
      return graphLayout?.clusters ?? NO_CLUSTERS;
    },

    index(): AggregateIndex | undefined {
      return aggregateIndex;
    },

    hullPadding(): number {
      return graphHullPadding;
    },
  };
}
