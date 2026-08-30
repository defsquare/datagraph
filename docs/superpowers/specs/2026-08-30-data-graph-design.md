# data-graph — Design

**Date** : 2026-08-30
**Statut** : validé (brainstorming section par section avec David)

## Vision

Une lib de visualisation façon jsoncrack, publiable et générique, pour explorer des
objets complexes — agrégats et entités au sens DDD. Là où jsoncrack visualise un arbre
JSON, data-graph visualise un **graphe** : les références entre entités
(`Order.customerId` → `Customer#42`) deviennent des arêtes de première classe.

Contraintes fortes validées :

- **Agnostique framework** : API impérative montable partout (React, Vue, Reagent, vanilla).
- **Tenue en charge** : ~10 000 nœuds logiques, fluide.
- **v1** : pan/zoom, collapse/expand, fit-to-view, recherche avec highlight et
  navigation, sélection + suivi de référence. Pas d'export, pas d'édition.
- **Design system Defsquare** comme thème par défaut (tokens copiés, pas de dépendance
  runtime au projet Claude Design).

## Architecture retenue (approche A)

Cœur headless + renderer Pixi.js (WebGL). Deux packages npm (monorepo TypeScript, ESM) :

- **`@defsquare/data-graph-core`** — headless : parsing, modèle de graphe, layout
  (orchestration elkjs), index de recherche, état de collapse, diagnostics. Zéro DOM,
  tourne en Node.
- **`@defsquare/data-graph`** — renderer Pixi.js, dépend du core. Le package que les
  utilisateurs installent.

Approches rejetées : reaflow (couplé React, SVG qui s'effondre avant 10k nœuds),
canvas 2D maison (réimplémente ce que Pixi donne gratuitement).

## Modèle de graphe (core)

### Entrée

Un document JSON + une config déclarative :

```ts
const config = {
  entities: {
    // clé = type d'entité, valeur = comment la reconnaître
    Customer: { match: "$.customers[*]", id: "id" },
    Order:    { match: "$.orders[*]",    id: "id" },
  },
  references: {
    // par type source : champ → type d'entité cible
    Order: { customerId: "Customer" },
  },
}
```

`match` est un sélecteur de chemin : sous-ensemble simple de JSONPath (segments
littéraux + wildcard `[*]` et `.*`), pas le standard complet. `id` désigne le champ
identifiant, utilisé pour résoudre les références par valeur.

### Modèle interne

Trois sortes de nœuds :

- **Nœud entité** : racine d'un agrégat reconnu par la config (type + id). Unité de
  collapse par défaut, visuellement distinct.
- **Nœud objet/tableau** : structure imbriquée non-entité.
- **Champs scalaires groupés** : les paires clé/valeur scalaires d'un objet sont des
  *lignes* du nœud parent, pas des nœuds séparés (comme jsoncrack). Un agrégat de 50
  champs = quelques nœuds visuels. C'est ce qui rend 10k nœuds logiques tenables.

Deux sortes d'arêtes :

- **Imbrication** (parent → enfant, trait plein) — structure en arbre, layoutée.
- **Référence** (`Order.customerId` → `Customer#42`, pointillée, style distinct) —
  se superpose librement au layout, les cycles sont un cas nominal.

Une référence dont la cible n'existe pas est conservée comme **référence pendante**
(affichée grisée/rouge, utile pour diagnostiquer un agrégat incomplet).

Chaque nœud a un **id stable** dérivé de son chemin dans le JSON source — base de la
sélection, de la recherche, et d'un futur diff.

## API publique (renderer)

```ts
import { createDataGraph } from "@defsquare/data-graph"

const graph = createDataGraph(containerElement, {
  data,          // le JSON
  config,        // entités + références
  theme?,        // tokens (défaut : thème Defsquare)
})

// Navigation
graph.fit()
graph.expand(nodeId); graph.collapse(nodeId)
graph.focus(nodeId)            // centre + zoom sur un nœud

// Recherche
graph.search("dupont")         // → SearchResult[] (ids + chemins)
graph.nextMatch(); graph.prevMatch()

// Sélection
graph.on("select", (node) => ...)
graph.on("followRef", (edge) => ...)
graph.select(nodeId)

// Cycle de vie
graph.setData(data, config?)
graph.destroy()
```

Choix assumés :

- **Le panneau de détail n'est pas dans la lib.** `select` émet le nœud complet
  (valeurs, chemin, type) ; l'hôte affiche le détail. La lib fournit le highlight
  visuel (nœud sélectionné + chemin + références sortantes).
- **Pas de wrapper React en v1** : l'API impérative se monte en trois lignes dans un
  `useEffect` ; wrapper officiel plus tard si demande.
- **Thème surchargeable** : défaut Defsquare, mais tout token est remplaçable —
  indispensable pour une lib générique.

## Layout et performance

Quatre mécanismes complémentaires pour tenir 10k nœuds :

1. **Collapse par défaut, layout incrémental.** Au chargement, seules les entités
   racines sont visibles, repliées. elkjs (algorithme `layered`, gauche→droite) ne
   calcule que ce qui est déplié. Déplier relance un layout **partiel** : sous-arbre
   layouté, fratries décalées — jamais de re-layout global, jamais 10k nœuds d'un coup
   dans elkjs. (Compromis assumé : layout globalement moins « optimal » qu'un
   re-layout complet.)
2. **Layout dans un Web Worker.** Le canvas reste interactif pendant le calcul ;
   indicateur discret sur le nœud en expansion. Layout async côté core (`Promise`),
   transition animée côté renderer.
3. **Culling + level-of-detail.** Pixi ne dessine que le viewport. Trois niveaux au
   zoom arrière : texte complet → titres seuls → rectangles colorés par type. Texte en
   `BitmapText` (atlas de glyphes) — le rendu texte est le coût n°1 en WebGL.
4. **La recherche contourne le collapse.** Index construit au parsing (dans le worker),
   couvrant tout le graphe replié ou non. Naviguer vers un résultat déplie
   automatiquement le chemin puis `focus()`. Insensible à la casse, sur clés + valeurs
   scalaires + ids d'entités ; simple `includes` en v1.

### Budgets de perf (critères d'acceptation mesurables)

| Opération | Budget |
|---|---|
| Parsing + indexation de 10k nœuds | < 1 s |
| Expansion d'un nœud (layout partiel inclus) | < 300 ms perçus |
| Pan/zoom | 60 fps avec 2 000 nœuds visibles |
| Recherche | < 50 ms |

## Gestion d'erreurs

Principe : une donnée imparfaite dégrade la visu, elle ne la casse jamais.

- **Config invalide** (sélecteur mal formé, type de référence inconnu) → erreur
  explicite au `createDataGraph`, avant tout rendu. Bug de l'intégrateur : échec
  rapide et clair.
- **Données imparfaites** → dégradation locale : référence pendante grisée/rouge,
  entité sans `id` traitée comme objet ordinaire, doublon d'id signalé. Le core
  collecte tout dans `graph.diagnostics()` (liste structurée : code, chemin, message).
- **Cycles de références** : cas nominal (seule l'imbrication est layoutée en arbre).
- **Limite dure** : au-delà d'un seuil (défaut 50k nœuds logiques, configurable),
  refus explicite avec message clair plutôt qu'un onglet gelé.

## Thème

Objet plat de tokens, pas de système de plugins :

```ts
theme: {
  fonts: { body, mono },                    // défaut : IBM Plex Sans Condensed / Plex Mono
  colors: {
    background, nodeFill, nodeStroke, text, textMuted,
    entity,          // accent des nœuds entités (défaut : rouge Defsquare)
    refEdge, containEdge, selection, searchHighlight, danglingRef,
  },
  byEntityType?: { Customer: { accent }, ... },  // couleur par type d'agrégat
}
```

Le thème par défaut est extrait des tokens du Defsquare DS (`colors_and_type.css` du
projet Claude Design « Defsquare Design System ») au moment de l'implémentation —
valeurs **copiées** dans le code. Un second thème neutre clair/sombre est fourni pour
les utilisateurs externes.

## Tests

Le cœur headless rend le gros de la valeur testable sans navigateur :

- **Core (vitest, TDD)** : parsing JSON+config → graphe attendu, résolution de
  références (pendantes, doublons, cycles), sélecteurs de chemin, index de recherche,
  état de collapse, diagnostics. Fixtures : agrégats DDD e-commerce
  (Customer/Order/Product) petit, moyen (~1k), gros (~10k nœuds, généré).
- **Layout (intégration, Node)** : elkjs tourne en Node → tests du layout incrémental
  (déplier un nœud ne déplace pas les nœuds hors de son impact, positions stables).
- **Renderer (Playwright sur l'app démo)** : smoke tests des interactions v1 —
  clic → `select`, recherche → dépliage auto + focus, collapse/expand, pan/zoom.
  Pas de visual regression en v1.
- **Perf** : script de bench dédié pour les budgets ci-dessus (non bloquant en CI au
  début, mesuré et tracé).

## Outillage et démo

- Monorepo **pnpm workspaces** : `packages/core`, `packages/renderer`, `apps/demo`.
- TypeScript strict, build **tsup** (ESM + types), vitest, Playwright.
- Publication npm des deux packages.
- **`apps/demo`** (Vite, vanilla TS) : harnais de dev quotidien, banc Playwright, et
  vitrine publiée (page statique). C'est là que le DS Defsquare s'exprime (chrome de
  page, panneau de détail branché sur `select`, champ de recherche). La lib reste un
  canvas nu.
