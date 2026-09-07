# Vue structure à l'échelle : budget initial, révélation par pages, maxNodes

**Date** : 2026-09-07
**Statut** : validé (décisions produit et architecture approuvées en brainstorming)

## Problème

`datagraph data.json` refuse tout document au-delà de 50 000 nœuds logiques
(`GraphTooLargeError`), et ce plafond protège en réalité le mauvais coût :
`buildGraph` est linéaire et quasi gratuit (22 ms à 50k), c'est la mise en page
ELK de la vue structure qui explose en ~n^1.7 — 16,5 s pour les 16 671 cartes
qu'un document de 50k rend visibles, OOM vers 33 000 cartes.

La cause est la politique de dépliage initial (`CollapseState`, constructeur) :
BFS qui déplie tout nœud non-entité et ne s'arrête qu'aux frontières
d'entités. Sans config (`datagraph data.json` sans `-c` fabrique `{ ids: {} }`),
il n'y a aucune entité, donc aucun frein : le document entier part dans ELK en
un appel. Le moteur incrémental (`layoutAfterExpand`) existe et borne déjà le
coût des dépliages *suivants* — seul le premier appel est massif.

## Décisions (approuvées)

1. **Ouverture** : aperçu replié sous un budget de cartes ; l'exploration passe
   par le clic, chaque dépliage étant incrémental.
2. **Périmètre** : le budget s'applique *toujours*, avec ou sans config. Le
   dépliage initial s'arrête au premier des deux — frontière d'entité OU budget
   atteint. Les documents qui tiennent sous le budget sont visuellement
   inchangés.
3. **Gros dépliages** : pagination. Un dépliage révèle la première page
   d'enfants (~100) et pose un jeton reliquat cliquable.
4. **maxNodes** : relevé à 1 000 000 (validé au bench : 479 Mo de heap et
   814 ms de build+index à 1 M) ; il redevient une garde
   mémoire sur `buildGraph` + index, plus une garde de layout. Message d'erreur
   enrichi de l'échappatoire (`maxNodes` en config).
5. **Dérive incrémentale** : action explicite « Ranger » (`tidy()`) qui relance
   la mise en page globale sur l'ensemble visible — désormais borné, donc bon
   marché — puis recadre. Stabilité spatiale par défaut, réparation à la
   demande.

**Architecture retenue** : la politique budget + pagination vit dans
`CollapseState` (approche B), amendée par la contrainte de la recherche :
**révélation par pages alignées, pas par préfixe**. Le graphe reste une
représentation fidèle et complète de la donnée ; recherche, refs et
diagnostics ne voient jamais de nœud fictif.

## La contrainte qui a dicté la forme : la recherche

L'index couvre le document entier (`buildSearchIndex(graph)`, linéaire, bon
marché) et `step()` → `focus(id)` fait déjà de l'auto-révélation : les ancêtres
repliés du résultat sont dépliés un à un (`create.ts`, cascade gardée par
`opGen`). Ce contrat est conservé tel quel.

Une pagination par préfixe (« les N premiers ») le casserait : atteindre
`orders[47 312]` forcerait à révéler 47 313 cartes. D'où la révélation par
**pages alignées** : la recherche ne révèle que la page contenant la cible,
avec des jetons reliquat de part et d'autre :

```
orders [ 48 000 items ]
  ├─ [ + 47 300 avant ]
  ├─ orders[47 300] … orders[47 399]   ← la page de la cible
  └─ [ + 600 après ]
```

## Design

### 1. `CollapseState` : budget initial et pages révélées

**État nouveau** : `revealedPages: Map<NodeId, Set<number>>` — pour un nœud
déplié, les numéros de pages d'enfants-cartes révélées. **Absence d'entrée =
`{0}`** (la première page) : le dépliage manuel ordinaire ne crée donc aucun
état supplémentaire, la pagination est implicite dès que
`childIds` dépasse `PAGE_SIZE`.

- `PAGE_SIZE = 100` (constante exportée du core ; pas de réglage utilisateur —
  YAGNI).
- Les pages sont **alignées** (`page p` couvre les indices `[p·100, (p+1)·100)`) :
  l'union de pages remplace toute arithmétique de fusion de plages.
- Seuls les enfants-**cartes** (non élidés) sont paginés et comptés. Les
  enfants élidés (lignes-jetons `[ n items ]` sur la carte parente) restent
  toujours visibles, comme aujourd'hui — ils sont des lignes, pas des cartes.
- La pagination s'applique aux enfants de **tout** nœud déplié, quel que soit
  son `kind` : un objet à 10 000 enfants est paginé comme un tableau. Aucun
  cas spécial.

**Constructeur** : le BFS actuel gagne un budget.
`INITIAL_CARD_BUDGET = 300` (constante core). Le BFS marque « déplié » comme
aujourd'hui (règle d'entité conservée) mais tient le compte des cartes que
chaque marquage révélerait (`min(enfants-cartes, PAGE_SIZE)` par nœud déplié) et
cesse de marquer une fois le budget atteint. Les nœuds déjà atteints mais non
marqués restent des cartes repliées visibles — l'aperçu. Le BFS garantit que
les niveaux hauts sont servis d'abord.

**API nouvelle** :
- `revealedPages(id): ReadonlySet<number>` — lecture, défaut `{0}`.
- `revealPage(id, page)` — ajoute une page (clic sur un jeton reliquat,
  révélation par la recherche).
- `hiddenGaps(id): { fromIndex: number; count: number; nextPage: number }[]` —
  les trous entre pages révélées et en queue, en ordre d'indices croissants :
  `fromIndex` est l'indice du premier enfant-carte caché du trou, `count` le
  nombre d'enfants-cartes cachés, `nextPage` la page à passer à `revealPage`
  au clic du jeton (la première page du trou). Le renderer dessine les jetons
  directement depuis cette liste, sans refaire le calcul.
- `visibleNodeIds()` : inchangé dans son contrat, mais ne descend et n'inclut,
  parmi les enfants-cartes d'un nœud déplié, que ceux des pages révélées.
- `expandPathTo(id)` : en plus de déplier les ancêtres, s'assure à chaque
  niveau que l'indice de l'enfant sur le chemin appartient à une page révélée
  (`revealPage` de la page le contenant sinon). Rend, comme aujourd'hui, la
  liste de ce qui a changé pour que la cascade de `create.ts` reste pas-à-pas.
- Au repli d'un nœud, ses `revealedPages` et celles de ses descendants sont
  **conservées** — même politique que l'ensemble `expanded` aujourd'hui : re-
  déplier remontre ce qu'on avait révélé.

### 2. Mise en page : extension de plage

`layoutAfterExpand` traite déjà « un sous-graphe nouveau, ancré quelque part,
le reste décalé vers le bas ». L'extension de page est une variante du même
mécanisme, avec une ancre différente :

- **Page suivante contiguë** (clic jeton de queue) : ancre = la dernière carte
  révélée de la page précédente ; les nouvelles cartes se posent dessous, dans
  la même colonne ; ce qui est sous l'ancre est décalé du débordement
  (mécanique de delta existante, mémorisée pour le repli).
- **Page disjointe** (recherche, jeton amont) : ancre = la dernière carte du
  bloc révélé qui précède, ou l'ancre du parent (`anchorRectFor`) s'il n'y en a
  pas ; même pose, même décalage.
- Le repli (`layoutAfterCollapse`) réutilise l'annulation de deltas existante ;
  l'approximation assumée sur les compositions de décalages (commentaire en
  tête de `layoutAfterCollapse`) reste assumée — c'est précisément ce que
  `tidy()` répare.

Forme retenue : une méthode dédiée `layoutAfterReveal(prev, graph, parentId,
newlyVisible, visible, metrics?)` sur le moteur, qui calcule elle-même son
ancre (dernière carte du bloc révélé précédant les nouveaux indices, sinon
`anchorRectFor(parentId)`) et partage avec `layoutAfterExpand` un helper
interne extrait — pose du sous-graphe isolé + décalage delta/threshold + 
mémorisation pour le repli. La mécanique delta reste unique ; `layoutAfterExpand`
garde sa signature et son comportement actuels.

### 3. Jetons reliquat (renderer)

Un jeton reliquat est un **pseudo-élément du renderer**, pas un nœud du graphe
ni une boîte ELK : `draw.ts` reçoit la donnée nue (`count`, position, taille)
et le dessine ; `create.ts` le positionne par arithmétique (même colonne que
les cartes de la plage, sous la dernière carte du bloc / au-dessus de la
première pour un trou amont) et câble son clic sur `revealPage` + mise en page
incrémentale. Aucun impact sur la recherche, les refs, `stats()` ni les
diagnostics — le graphe ne les contient pas.

Formes : trou amont « + n avant », trou entre pages « + n », queue « + n
restants ». Le jeton de queue coexiste avec la ligne-jeton `[ n items ]`
existante : celle-ci ouvre le tableau (première page), celui-là étend les pages
d'un tableau déjà ouvert.

### 4. `tidy()` : réparation explicite

Nouvelle méthode publique de l'instance (`create.ts`) :

1. relance `engine.layout(graph, visible)` — le chemin global existant — sur
   l'ensemble visible courant (borné par construction : budget + pages) ;
2. purge la mémoire de deltas du moteur (le layout global est la nouvelle
   vérité, les décalages incrémentaux passés n'ont plus à être annulables) ;
3. recadre (`fitTo`).

Gardée par `opGen` + `destroyed` comme toute opération mutante async. La démo
gagne un bouton « Ranger » dans son chrome.

### 5. `maxNodes` : garde mémoire, défaut relevé

- Le défaut passe de `50_000` à **`1_000_000`**, validé au bench : le bench
  (`packages/core/bench`) gagne une mesure `buildGraph` + `buildSearchIndex` +
  heap à 100k / 500k / 1M, en process isolé par palier (`BENCH_SCALE_N`).
  Mesuré, sous options node par défaut : 95 Mo / 66 ms à 100k, 291 Mo / 338 ms
  à 500k, 479 Mo / 814 ms à 1 M — croissance linéaire, ~3× de marge sous le
  budget de ~1,5 Go visé. La cible 1 M tient, le défaut est figé là.
- Le message de `GraphTooLargeError` gagne l'échappatoire : dépasser le
  plafond dit comment le relever (`maxNodes` dans la config `-c`).
- Le champ de config existe déjà et reste : rien d'autre ne change.

### 6. Hors périmètre (explicite)

- **Vue graphe à l'échelle** (agrégats et layout ELK deux niveaux sur 50k+
  entités) : problème distinct, non traité ici. Sans config il n'y a pas
  d'entités, donc pas de vue graphe — le mode qui a révélé le bug n'est pas
  concerné.
- Parsing JSON en streaming, virtualisation du rendu de la vue structure.
- Réglage utilisateur de `PAGE_SIZE` / `INITIAL_CARD_BUDGET`.

## Données et invariants

- Le graphe (`buildGraph`) reste complet et fidèle : aucun nœud de pagination,
  aucun changement de `logicalNodeCount`.
- `CollapseState` reste le point de vérité unique de la visibilité : layout,
  renderer et recherche lisent tous `visibleNodeIds()`.
- Toute révélation (clic, jeton, recherche) est bornée par `PAGE_SIZE` cartes
  par étape ; l'ensemble visible ne croît que par gestes utilisateur bornés.
- La cascade de `focus` garde sa discipline existante : mutation de
  `CollapseState` pas-à-pas, en synchronisation avec le layout appliqué,
  abandonnable par `opGen` à chaque étape.

## Tests

- **Core, `CollapseState`** : budget initial (s'arrête au budget, niveaux hauts
  d'abord, règle d'entité conservée, petit doc inchangé) ; pages (défaut `{0}`,
  `revealPage`, `hiddenGaps`, enfants élidés jamais paginés) ; `expandPathTo`
  vers un indice profond (révèle la bonne page à chaque niveau, idempotent).
- **Core, layout** : extension contiguë (pose sous la dernière carte, décalage
  du dessous), page disjointe (pose au bon bloc), repli après extensions
  (annulation des deltas), `tidy` (layout global + purge des deltas).
- **E2E (démo)** : fixture générée grosse (~10k nœuds suffisent à prouver la
  politique sans ralentir la CI) — ouverture rapide avec jetons ; clic jeton →
  page suivante dessinée (hit-test) ; recherche d'une valeur en page profonde →
  cible centrée, surlignée, jetons amont/aval présents ; bouton Ranger →
  la vue reste cohérente (hit-test après).
- **Bench** : la mesure 100k/500k/1M qui fige le défaut de `maxNodes`.

## Migration / compatibilité

- Documents actuels sous le budget : aucun changement visuel.
- Documents au-dessus : s'ouvrent désormais (c'était une erreur) — pas de
  compat à préserver.
- API publique : ajout de `tidy()` ; aucun retrait. `DataGraphConfig`
  inchangé hors valeur par défaut de `maxNodes`.
