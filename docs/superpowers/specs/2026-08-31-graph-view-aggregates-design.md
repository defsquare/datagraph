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
  dessinés comme des enveloppes ; ~~une entité peut appartenir à plusieurs
  agrégats à la fois~~ RÉVISÉ : l'appartenance est une **partition** — voir la
  section « Règle d'appartenance ».

La vue structure actuelle — containment, ELK layered, expand/collapse du JSON —
**n'est pas modifiée**. Les deux vues partagent la sélection.

### Décisions cadrantes

| Décision | Choix retenu |
|---|---|
| Sommets de la vue graphe | Entités seulement ; racine, tableaux et objets imbriqués ne sont pas dessinés |
| Définition d'un cluster | Agrégat déclaré dans la config, pas de détection automatique |
| Périmètre | Deux vues coexistantes, bascule explicite |
| Appartenance multiple | ~~Autorisée : une entité peut être dans plusieurs agrégats~~ RÉVISÉ : **interdite**, l'égalité de distance est arbitrée par l'ordre de déclaration |
| Forme des enveloppes | ~~Convexe matelassée (pas de bubble-sets concaves)~~ RÉVISÉ : **cercle englobant minimal** matelassé — voir `hull.ts` |
| État initial des agrégats | Dépliés |

## Règle d'appartenance

> Une entité E appartient à l'agrégat de racine R si R est **la gagnante** parmi
> les racines que E atteint **à distance minimale**, en suivant les références
> sortantes. Une racine est à distance 0 d'elle-même. À distance égale, gagne la
> racine dont le TYPE est déclaré en premier dans `config.aggregates`, puis, à
> type égal, celle dont l'id d'agrégat est le plus petit.

Formellement : soit `d(E, R)` le nombre minimal d'arêtes `refEdge` sortantes
menant de E à R. Soit `dmin(E) = min{ d(E, R) | R racine, d(E, R) fini }` et
`S(E) = { R | d(E, R) = dmin(E) }`. Alors E appartient à l'agrégat `min S(E)`,
pour l'ordre total (rang de déclaration du type, id d'agrégat).

**L'appartenance est donc une PARTITION** : toute entité atteignant au moins une
racine a exactement un agrégat.

Cette règle a trois propriétés voulues :

- **L'égalité de distance est arbitrée, pas partagée.** `Order o3 → Customer c1`
  et `Order o3 → Product p9`, les deux types étant racines : égalité à 1 saut,
  et `Customer` étant déclaré en premier, o3 rejoint son agrégat et lui seul.
- **Elle est transitive quand il le faut.** `LineItem → Order → Customer` :
  le LineItem rejoint l'agrégat de Customer à 2 sauts.
- **Elle borne l'explosion des hubs sans réglage.** Si `Customer → Country` et
  que Country est aussi racine, une transitivité naïve mettrait tout le monde
  dans l'agrégat Country. Ici non : un Order atteint Customer à 1 saut et
  Country à 2, il reste donc chez Customer. Aucun `maxDepth` à régler à
  l'aveugle.

> **~~Chevauchement à égalité de distance~~ RETIRÉ.** La règle d'origine faisait
> appartenir E à TOUTES les racines de `S(E)`, et le chevauchement était présenté
> comme une capacité voulue : « le chevauchement n'apparaît que là où il est
> réel ». Il l'était ; il coûtait la passe d'écartement des clusters. Une entité
> partagée ne peut pas être arrachée à l'un de ses agrégats, donc
> `separateClusters` fusionne par union-find tout agrégat relié par un membre
> commun — et sur un graphe biparti la fusion percole. MESURÉ sur le jeu de la
> démo (`bigShop(4000)`, 350 entités, 108 agrégats, deux racines déclarées, même
> mise en page et mêmes enveloppes, seule la règle changeant) : avec
> chevauchement, 9 super-clusters dont un de 342 cartes sur 350 (97,7 %) et
> 3520 des 5778 paires d'enveloppes en recouvrement ; avec arbitrage, 116
> super-clusters, le plus gros de 5 cartes (1,4 %), 0 paire en recouvrement. La
> transitivité et la borne des hubs, elles, survivent intactes : seule la
> branche « distance égale » change.

Cas limites, tous à couvrir par des tests :

- Une racine appartient toujours à son propre agrégat et à lui seul
  (`d(R, R) = 0`, minimal par construction) : une racine n'est jamais absorbée
  par une autre.
- Deux racines du même type à distance égale : départagées par l'id d'agrégat,
  pour que le résultat ne dépende ni de l'ordre du JSON ni de l'ordre de
  parcours du BFS.
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
`references`. L'ordre de déclaration est conservé, et ~~il ne joue aucun rôle
dans l'appartenance (le chevauchement rend tout arbitrage inutile)~~ RÉVISÉ :
il est **porteur** — c'est lui qui arbitre les égalités de distance, donc qui
décide de l'agrégat d'une entité. Il fixe aussi l'ordre de peinture des
enveloppes, pour que le rendu soit reproductible.

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
  /** L'appartenance est une partition : exactement un id par entité. Le type
   *  reste `string[]` — voir la garantie inactive de `cluster-separate.ts`. */
  byNode: Map<NodeId, string[]>
}

export function buildAggregates(graph: Graph, config: ValidatedConfig): AggregateIndex
```

Implémentation : un BFS **multi-source inverse** sur `refEdges`. On construit
l'adjacence inverse (cible → sources), on initialise la file avec toutes les
racines à distance 0, et on propage. Chaque nœud retient sa distance minimale
et UNE racine ; une racine découverte à une distance strictement supérieure à
celle déjà connue est ignorée, une racine à distance égale ne remplace la
racine tenue que si elle l'emporte pour l'ordre total (rang de déclaration, puis
id).

Le BFS ne propage que le gagnant de chaque prédécesseur, pas l'ensemble des
racines qu'il atteint. C'est exact : `S(E)` est l'union des `S(P)` sur les
successeurs P de E à distance minimale, et le minimum d'une union est le minimum
des minima. C'est aussi ce qui rend le résultat indépendant de l'ordre de
découverte, donc déterministe.

Un seul parcours pour toutes les racines, donc linéaire en (entités +
références) — pas un BFS par racine.

`buildGraph` n'est **pas** modifié : `refEdges` et `entityIndex` fournissent
déjà tout le nécessaire.

### `hull.ts` — nouveau

```ts
export interface Circle { cx: number; cy: number; r: number }
/** Cercle englobant minimal des coins des rectangles, rayon + `padding`. */
export function enclosingCircle(rects: Rect[], padding: number): Circle
```

Algorithme de Welzl, forme itérative à trois boucles, sur les 4 coins de chaque
rectangle. Gonfler le RAYON en sortie est ici exact : dilater un cercle de
`padding` revient exactement à ajouter `padding` à son rayon, sans bissectrice
ni coin rentrant à traiter.

**L'entrée n'est pas mélangée.** La borne linéaire en espérance de Welzl repose
sur une permutation aléatoire ; sans elle, le pire cas est cubique. Mais le
déterminisme au pixel est une exigence dure de cette vue, et les tailles en jeu
rendent l'arbitrage facile : 4 points pour l'agrégat d'une seule carte — le cas
courant — et 20 pour le plus gros du jeu de démo. Un ordre fixe est le bon
compromis à cette échelle ; il cesserait de l'être sur des agrégats de plusieurs
centaines de cartes.

Cas limites à tester : un seul rectangle (son cercle circonscrit), deux
rectangles, des centres colinéaires, des rectangles identiques superposés, un
rectangle de taille nulle, une liste vide (cercle nul).

> **~~Enveloppe convexe matelassée~~ RETIRÉE.** La première version calculait un
> polygone convexe (balayage de Andrew sur les coins de rectangles gonflés) et
> `paddedHull` / `Point` étaient exportés depuis le barrel du cœur. Deux raisons
> de l'avoir remplacée par le cercle. D'abord la cohérence : la passe
> d'écartement (`cluster-separate.ts`) relaxait des BOÎTES englobantes axiales
> pendant que le renderer traçait ce POLYGONE — le couloir mesuré n'était donc
> pas le couloir regardé. Avec le cercle, écartement et tracé partagent une
> seule forme et une seule marge. Ensuite la simplicité : la poussée se fait le
> long de la droite des centres, sans choix entre deux pénétrations axiales, et
> le test de recouvrement de deux enveloppes redevient une comparaison de
> distances. Le prix mesuré est une bbox plus large — un cercle circonscrit est
> plus large que la boîte qu'il enferme, ×6,8 d'aire au `clusterGap` par défaut
> contre ×5,3 pour la relaxation sur boîtes — et un recouvrement à gap 0
> plus élevé parce qu'on mesure enfin la vraie forme (911 paires contre 310).

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
  clusters: { aggregateId: string; rootId: NodeId; cx: number; cy: number; r: number }[]
}

export interface GraphLayoutEngine {
  layout(graph, aggregates, visible, metrics?): Promise<GraphLayoutResult>
  // RETIRÉ avec le pli d'agrégat — voir la section « Dépliage » plus bas :
  //   layoutAfterExpand(prev, graph, aggregates, expandedAggId, visible, metrics?)
  //   layoutAfterCollapse(prev, graph, aggregates, collapsedAggId, visible)
}

export interface GraphLayoutOptions {
  /** Marge entre le coin de carte le plus éloigné du centre de l'enveloppe et
   * le bord de celle-ci. */
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

   Le regroupement vient donc uniquement des arêtes de référence déjà posées ;
   seule l'enveloppe, tracée après coup à partir des positions obtenues, reste
   propre à l'agrégat. (L'argument d'origine invoquait ici le chevauchement —
   une entité partagée tombant naturellement dans les deux polygones — mais il
   ne portait pas le retrait du centre virtuel, que la mesure ci-dessus suffit
   à justifier ; il est caduc depuis que l'appartenance est une partition.)
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
6. **Enveloppes** : `enclosingCircle` sur les rectangles des membres visibles de
   chaque agrégat, dans l'ordre stable de `ValidatedConfig.aggregates`, à la
   MÊME marge que celle passée à `separateClusters` juste avant.

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
  padding: number,
): void
```

`separateOverlaps` écarte les CARTES ; elle ne dit rien des AGRÉGATS, et sans
seconde passe les enveloppes s'interpénètrent — mesuré sur `bigShop(3000)` :
911 paires d'enveloppes en recouvrement, −289,8 px d'écart bord à bord moyen au
plus proche voisin. Cette passe-ci reprend la même mécanique de relaxation à la
granularité du cluster : **cercle englobant** par agrégat, à la MÊME marge que
le tracé (d'où le paramètre `padding`), poussée le long de la droite des centres
jusqu'à `r₁ + r₂ + clusterGap`, puis **translation rigide** de chaque membre par
le déplacement total de son cluster. C'est la rigidité qui la rend sûre : la
géométrie interne d'un agrégat traverse la passe intacte, et comme rien ne
relance `separateOverlaps` derrière, c'est aussi ce qui garantit qu'aucun
recouvrement de cartes n'y apparaît.

> **~~Relaxation sur boîtes englobantes~~ RÉVISÉE.** La première version relaxait
> des boîtes axiales — poussée le long de l'axe de moindre pénétration — alors
> que le renderer traçait une enveloppe convexe. Les deux formes ne coïncidaient
> nulle part : la passe garantissait `gap` entre des boîtes qu'on ne voyait
> jamais. Ses chiffres sur `bigShop(3000)` (310 paires en recouvrement, 0,7 px
> d'écart moyen à gap 0) mesuraient donc une autre forme que celle affichée, et
> ne sont pas comparables à ceux ci-dessus. La rigidité y était de surcroît bit
> à bit par accident : une poussée axiale tombe sur des flottants exacts, ce que
> la poussée le long des centres ne fait pas (écart maximal mesuré : 2,84e-14 px).

Deux cas particuliers. Une entité sans agrégat forme un cluster d'un seul, pour
être poussée hors des enveloppes voisines. Et **les agrégats qui partagent une
entité fusionnent** en un super-cluster, par union-find, avant la relaxation :
une entité partagée est membre à part entière de chacun de ses agrégats, donc
lui donner un déplacement propre la détacherait de ses co-membres. Des agrégats
tricotés par une entité commune ne se séparent pas sans la déchirer ; ils se
déplacent ensemble.

> **Garantie INACTIVE, et gardée telle quelle.** Depuis que l'appartenance est
> une partition, aucune entité n'est partagée : l'union-find ne fusionne jamais
> rien et un super-cluster est toujours exactement un agrégat. On le garde
> quand même, et ce n'est ni du code mort ni une fonctionnalité — c'est ce qui
> GARANTIT qu'une carte ne reçoit qu'une seule translation, donc que l'étape de
> report reste rigide. Cette garantie appartient à la passe ; la règle
> d'appartenance, elle, est un choix de produit qui peut être assoupli. Le
> supprimer armerait un piège : la passe reprendrait alors silencieusement le
> défaut décrit juste en dessous, sans qu'aucun test de la règle actuelle ne le
> voie. `cluster-separate.test.ts` continue de le couvrir sur des index
> d'agrégats montés à la main, seule voie qui sache encore exprimer un membre
> partagé.

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

**~~Coût de la fusion, mesuré~~ — RETIRÉ avec le chevauchement.** Toute cette
section décrivait la dégénérescence de la fusion sur un modèle à hub, et c'est
elle qui a motivé le passage à une appartenance en partition. Elle est conservée
comme trace de la mesure qui a justifié le changement, et ses chiffres ne
décrivent plus le comportement actuel.

> La fusion est transitive : A partage avec B, B avec C, donc les trois n'en font
> qu'un. Sur deux racines dont chaque commande référence son client ET son
> produit : 334 agrégats → 167 super-clusters de 3 cartes, sans effet visible.
> Mais avec un CATALOGUE partagé, la fusion dégénérait : 20 produits → 20
> super-clusters (le plus gros 19 cartes), 3 produits → 3 super-clusters (le plus
> gros 113 cartes, 33 % du graphe), 1 produit → un seul super-cluster couvrant
> 100 % du graphe, où la passe ne pouvait plus rien écarter. C'était
> sémantiquement correct — ces agrégats étaient réellement inséparables — mais
> l'effet pratique était que l'écartement ne s'appliquait pas à ces données-là.
>
> **La démo, mesurée après coup.** Son config déclare deux racines
> (`aggregates: ["Customer", "Product"]`) sur `bigShop(4000)` — 350 entités,
> 108 agrégats — où chaque `Order` référence un `Customer` ET un `Product` à
> un saut, donc appartenait aux deux à la fois : le graphe biparti percolait.
> 9 super-clusters, le plus gros 342 des 350 cartes (97,7 %) — la passe
> d'écartement n'avait plus rien à séparer, hormis les 8 `Category` qu'aucun
> agrégat n'atteint.

**Mesure de sortie, sur les mêmes données et la même géométrie**, seule la règle
d'appartenance différant (`bigShop(4000)` de la démo, deux racines, enveloppes
circulaires dans les deux colonnes) :

| | chevauchement (retiré) | arbitrage (actuel) |
|---|---|---|
| super-clusters | 9 | **116** |
| plus gros bloc | 342 des 350 cartes (97,7 %) | **5 cartes (1,4 %)** |
| paires d'enveloppes en recouvrement | 3520 sur 5778 (61 %) | **0** |
| bbox | 7199 × 4588 | 18714 × 19984 |

Les 116 blocs sont 78 agrégats `Customer` (26 de 5 cartes, 26 de 4, 26 de 3),
30 agrégats `Product` d'une seule carte, et les 8 `Category` qu'aucun agrégat ne
réclame. Le prix est une bbox ~11× plus grande en aire, que `fit()` absorbe.
Reste hors de portée de ce changement : un CATALOGUE partagé ne fusionne plus
rien, mais rien ne garantit non plus que la répartition entre agrégats soit
« jolie » sur un modèle à hub — l'arbitrage donne un résultat déterministe et
lisible, pas nécessairement celui qu'un modélisateur aurait choisi.

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

Un calque `clustersGraphics` s'insère **sous** `edgesGraphics` dans
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
simple à 1 saut ; transitivité à 2 sauts ; égalité de distance arbitrée par
l'ordre de déclaration du type, et l'inversion de cet ordre qui renverse le
gagnant ; égalité entre deux racines du MÊME type départagée par l'id ;
invariant de partition (aucune entité dans deux agrégats) ; racine jamais
absorbée par une autre racine ; hub borné (le cas `Customer → Country` décrit
plus haut) ; entité n'atteignant aucune racine ; référence cassée ne propageant
rien ; cycle de références ; type racine sans instance.

**`hull.test.ts`** — cercle englobant minimal : cas nominal, un seul rectangle,
deux rectangles, centres colinéaires, rectangles superposés identiques,
rectangle de taille nulle, liste vide, déterminisme. Deux invariants vérifiés
systématiquement : tout coin de tout rectangle d'entrée est à l'intérieur ou sur
le bord du cercle rendu, et ce cercle est MINIMAL — le rétrécir d'un millième de
pixel fait sortir au moins un coin.

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
| ~~Remplissage~~ | RÉVISÉ : ~43 % atteint sans écartement des clusters, mais **6,2 %** au `clusterGap` de 160 px sur `bigShop(3000)` — prix assumé de l'écartement demandé, `fit()` recadrant de toute façon. (Le 7,9 % de la révision précédente était mesuré quand la passe relaxait des boîtes ; le cercle englobant est plus large, donc ouvre davantage.) |
| Chevauchement de cartes | 0 |
| Recouvrement d'enveloppes | 0 — acquis depuis que l'appartenance est une partition, y compris sur le jeu de la démo (108 agrégats, 5778 paires) |
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
- **Enveloppes concaves** type bubble-sets. (L'enveloppe convexe elle-même a été
  abandonnée depuis, au profit du cercle englobant minimal — voir `hull.ts`.)
- **Détection automatique de communautés** : écartée au profit des agrégats
  déclarés, pour le déterminisme et parce que la notion DDD est celle que la
  bibliothèque revendique déjà.
- **Recherche et diagnostics conscients des agrégats.**
- **Participation des `refEdge` au layout de la vue structure** : sondé,
  fonctionnel, mais coûteux (7,7 s contre 2,4 s à 800 nœuds) et non décisif.
