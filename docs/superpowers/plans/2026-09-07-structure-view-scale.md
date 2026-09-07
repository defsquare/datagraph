# Vue structure à l'échelle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir des documents de ~1 M de nœuds logiques dans la vue structure : dépliage initial sous budget, révélation par pages alignées (pagination + recherche), `tidy()` de réparation, plafond `maxNodes` relevé.

**Architecture:** La politique budget + pages vit entièrement dans `CollapseState` (core), point de vérité unique de la visibilité ; le graphe reste complet et fidèle (aucun nœud fictif). La mise en page réutilise la mécanique incrémentale delta/threshold existante via une nouvelle méthode `layoutAfterReveal`. Les jetons reliquat sont des pseudo-éléments du renderer, jamais des nœuds.

**Tech Stack:** TypeScript, vitest, elkjs, Pixi v8, Playwright (e2e), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-07-structure-view-scale-design.md` — lire ENTIÈREMENT avant toute tâche.

## Global Constraints

- Commentaires en **français**, documentant le « pourquoi » (contrainte/invariant), pas le « quoi » (CLAUDE.md).
- `draw.ts` ne prend que de la donnée nue — jamais de graphe ni d'état d'interface.
- Toute opération mutante async dans `create.ts` est gardée par `opGen` + `destroyed`, avec retour arrière de la mutation `collapseState` si supersédée (modèle : `doExpand`, `create.ts:2104-2137`).
- `PAGE_SIZE = 100`, `INITIAL_CARD_BUDGET = 300` : constantes exportées de `packages/core/src/collapse.ts`, pas de réglage utilisateur.
- Pages **alignées** : la page `p` couvre les indices de cartes `[p*100, (p+1)*100)` ; l'indice de carte d'un enfant est sa position **parmi les enfants non élidés** (`childIds` filtré), pas dans `childIds` brut.
- Les enfants élidés (lignes-jetons `[ n items ]`) ne sont **jamais** paginés ni comptés dans le budget : ce sont des lignes, pas des cartes.
- Tests : `pnpm --filter @defsquare/data-graph-core test`, `pnpm --filter @defsquare/data-graph test`, e2e `pnpm --filter demo e2e`. Typecheck : `pnpm typecheck` à la racine.
- Commits en français, format `type(scope): sujet`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: CollapseState — pages révélées

**Files:**
- Modify: `packages/core/src/collapse.ts`
- Modify: `packages/core/test/collapse.test.ts`
- Modify: `packages/core/src/index.ts` (exports)

**Interfaces:**
- Consumes: `Graph`, `NodeId`, `GraphNode.elided` (existants, `model.ts`).
- Produces (les tâches 4, 6, 7 s'appuient dessus — signatures exactes) :
  - `export const PAGE_SIZE = 100`
  - `pageOf(cardIndex: number): number` (export libre : `Math.floor(cardIndex / PAGE_SIZE)`)
  - `CollapseState.revealedPages(id: NodeId): ReadonlySet<number>` — défaut `{0}`
  - `CollapseState.revealPage(id: NodeId, page: number): void`
  - `CollapseState.unrevealPage(id: NodeId, page: number): void` (retour arrière des cascades ; retirer la page 0 est permis et signifie « rien de révélé »)
  - `CollapseState.hiddenGaps(id: NodeId): { fromIndex: number; count: number; nextPage: number }[]`
  - `CollapseState.cardIndexOf(parentId: NodeId, childId: NodeId): number` — `-1` si absent ou élidé
  - `visibleNodeIds()` : ne descend/inclut, parmi les enfants-cartes d'un nœud déplié, que ceux des pages révélées.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `collapse.test.ts`, ajouter un bloc. Fabriquer un graphe avec un tableau de 250 éléments objets via `buildGraph` (regarder en tête de fichier comment les tests existants construisent le leur ; sinon) :

```ts
import { buildGraph } from "../src/build.js"
import { CollapseState, PAGE_SIZE, pageOf } from "../src/collapse.js"

function manyItems(n: number): unknown {
  return { items: Array.from({ length: n }, (_, i) => ({ v: i, w: { deep: i } })) }
}
// `ids: {}` : aucune entité, comme le mode CLI sans config.
const noConfig = { ids: {} }

describe("CollapseState — pages révélées", () => {
  it("un nœud déplié ne montre que la première page de ses enfants-cartes", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    const visible = cs.visibleNodeIds()
    // les 100 premiers éléments sont visibles, pas le 101e
    expect(visible.has("/items/0")).toBe(true)
    expect(visible.has("/items/99")).toBe(true)
    expect(visible.has("/items/100")).toBe(false)
    expect(visible.has("/items/249")).toBe(false)
  })

  it("revealPage ajoute une page ; les descendants de la page suivent la règle normale", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    const visible = cs.visibleNodeIds()
    expect(visible.has("/items/200")).toBe(true)
    expect(visible.has("/items/249")).toBe(true)
    expect(visible.has("/items/100")).toBe(false) // la page 1 reste cachée
  })

  it("unrevealPage retire une page, y compris la page 0", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2)
    cs.unrevealPage("/items", 2)
    expect(cs.visibleNodeIds().has("/items/200")).toBe(false)
    cs.unrevealPage("/items", 0)
    expect(cs.visibleNodeIds().has("/items/0")).toBe(false)
  })

  it("hiddenGaps décrit les trous en ordre d'indices, avec la page à révéler", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    cs.revealPage("/items", 2) // révélé : pages {0, 2} sur 3 pages (250 cartes)
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 100, count: 100, nextPage: 1 },
    ])
    cs.unrevealPage("/items", 0) // révélé : {2}
    expect(cs.hiddenGaps("/items")).toEqual([
      { fromIndex: 0, count: 200, nextPage: 0 },
    ])
  })

  it("hiddenGaps est vide sous PAGE_SIZE enfants et pour un nœud inconnu", () => {
    const g = buildGraph(manyItems(50), noConfig)
    const cs = new CollapseState(g)
    expect(cs.hiddenGaps("/items")).toEqual([])
    expect(cs.hiddenGaps("/nope")).toEqual([])
  })

  it("cardIndexOf compte parmi les enfants-cartes ; élidé et absent rendent -1", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g)
    expect(cs.cardIndexOf("/items", "/items/0")).toBe(0)
    expect(cs.cardIndexOf("/items", "/items/113")).toBe(113)
    expect(cs.cardIndexOf("/items", "/absent")).toBe(-1)
  })

  it("pageOf aligne sur PAGE_SIZE", () => {
    expect(pageOf(0)).toBe(0)
    expect(pageOf(99)).toBe(0)
    expect(pageOf(100)).toBe(1)
  })
})
```

Attention au graphe réel : sous `{ ids: {} }`, `/items` peut être élidé (ligne-jeton sur la racine) — vérifier avec `g.nodes.get("/items")` et adapter les ids ou la fixture pour que les 250 enfants soient bien des **cartes** (les éléments objets d'un tableau le sont). Si `/items` est élidé, il est marqué déplié par le BFS actuel et ses enfants-cartes sont paginés pareil — les assertions ci-dessus restent bonnes ; sinon ajuster les chemins après un premier run en console.

- [ ] **Step 2: Vérifier l'échec**

`pnpm --filter @defsquare/data-graph-core test -- collapse` — attendu : FAIL (`revealPage` n'existe pas, `/items/100` visible).

- [ ] **Step 3: Implémenter dans `collapse.ts`**

```ts
export const PAGE_SIZE = 100

/** La page (alignée) qui contient l'indice de carte donné. */
export function pageOf(cardIndex: number): number {
  return Math.floor(cardIndex / PAGE_SIZE)
}
```

Dans la classe :

```ts
// Pages d'enfants-cartes révélées par nœud déplié. ABSENCE d'entrée = {0} :
// le dépliage ordinaire ne crée aucun état, la pagination est implicite dès
// que les enfants-cartes dépassent PAGE_SIZE. La présence d'une entrée fait
// foi, même vide (unrevealPage(id, 0) est un vrai état : « rien de révélé »).
private readonly revealed: Map<NodeId, Set<number>> = new Map()
private static readonly DEFAULT_PAGES: ReadonlySet<number> = new Set([0])

revealedPages(id: NodeId): ReadonlySet<number> {
  return this.revealed.get(id) ?? CollapseState.DEFAULT_PAGES
}

revealPage(id: NodeId, page: number): void {
  let pages = this.revealed.get(id)
  if (!pages) {
    pages = new Set(CollapseState.DEFAULT_PAGES)
    this.revealed.set(id, pages)
  }
  pages.add(page)
}

unrevealPage(id: NodeId, page: number): void {
  let pages = this.revealed.get(id)
  if (!pages) {
    pages = new Set(CollapseState.DEFAULT_PAGES)
    this.revealed.set(id, pages)
  }
  pages.delete(page)
}

/** Les enfants-cartes de `id`, dans l'ordre de `childIds`. */
private cardChildren(id: NodeId): NodeId[] {
  const node = this.graph.nodes.get(id)
  if (!node) return []
  return node.childIds.filter((c) => {
    const child = this.graph.nodes.get(c)
    return child !== undefined && !child.elided
  })
}

cardIndexOf(parentId: NodeId, childId: NodeId): number {
  return this.cardChildren(parentId).indexOf(childId)
}

hiddenGaps(id: NodeId): { fromIndex: number; count: number; nextPage: number }[] {
  const cards = this.cardChildren(id)
  if (cards.length <= PAGE_SIZE && this.revealedPages(id).has(0)) return []
  const pageCount = Math.ceil(cards.length / PAGE_SIZE)
  const pages = this.revealedPages(id)
  const gaps: { fromIndex: number; count: number; nextPage: number }[] = []
  let p = 0
  while (p < pageCount) {
    if (pages.has(p)) { p++; continue }
    const start = p
    while (p < pageCount && !pages.has(p)) p++
    const fromIndex = start * PAGE_SIZE
    gaps.push({ fromIndex, count: Math.min(p * PAGE_SIZE, cards.length) - fromIndex, nextPage: start })
  }
  return gaps
}
```

`visibleNodeIds()` : remplacer la boucle sur `childIds` par une version qui tient l'indice de carte — les élidés passent toujours, les cartes seulement si leur page est révélée :

```ts
visibleNodeIds(): Set<NodeId> {
  const visible = new Set<NodeId>()
  const stack: NodeId[] = [this.graph.rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = this.graph.nodes.get(id)
    if (!node) continue
    visible.add(id)
    const expanded = this.isExpanded(id)
    const pages = this.revealedPages(id)
    let cardIndex = 0
    for (const childId of node.childIds) {
      const child = this.graph.nodes.get(childId)
      if (!child) continue
      if (child.elided) { stack.push(childId); continue }
      if (expanded && pages.has(pageOf(cardIndex))) stack.push(childId)
      cardIndex++
    }
  }
  return visible
}
```

Exporter `PAGE_SIZE` et `pageOf` depuis `packages/core/src/index.ts` (à côté de l'export existant de `CollapseState`).

- [ ] **Step 4: Vérifier le vert + non-régression**

`pnpm --filter @defsquare/data-graph-core test` — TOUT le paquet doit passer (les tests existants de `CollapseState` couvrent des graphes < 100 enfants : la page 0 par défaut les laisse intacts).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/collapse.ts packages/core/src/index.ts packages/core/test/collapse.test.ts
git commit -m "feat(core): revelation par pages alignees dans CollapseState"
```

---

### Task 2: CollapseState — budget de dépliage initial

**Files:**
- Modify: `packages/core/src/collapse.ts` (constructeur)
- Modify: `packages/core/test/collapse.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `export const INITIAL_CARD_BUDGET = 300`
  - `new CollapseState(graph, opts?: { initialCardBudget?: number })` — l'appel à un argument reste valide partout (renderer, bench, tests).

- [ ] **Step 1: Tests qui échouent**

```ts
describe("CollapseState — budget initial", () => {
  // Trois niveaux : root -> a,b (objets) -> chacun 10 enfants objets.
  function tiers(): unknown {
    const child = () => Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`k${i}`, { leaf: i }]),
    )
    return { a: child(), b: child() }
  }

  it("cesse de déplier une fois le budget de cartes atteint, niveaux hauts d'abord", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g, { initialCardBudget: 5 })
    const visible = cs.visibleNodeIds()
    // la racine et ses 2 enfants tiennent dans 5 ; les 10 petits-enfants
    // de /a en feraient 13 -> /a et /b restent des cartes repliées visibles
    expect(visible.has("/a")).toBe(true)
    expect(visible.has("/b")).toBe(true)
    expect(cs.isExpanded("/a")).toBe(false)
    expect(visible.has("/a/k0")).toBe(false)
  })

  it("la racine est toujours dépliée, même sous un budget de 0", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g, { initialCardBudget: 0 })
    expect(cs.isExpanded(g.rootId)).toBe(true)
    expect(cs.visibleNodeIds().has("/a")).toBe(true) // enfants de la racine = cartes visibles repliées
  })

  it("un document sous le budget est intégralement déplié, comme avant", () => {
    const g = buildGraph(tiers(), noConfig)
    const cs = new CollapseState(g) // défaut 300 >> ~23 cartes
    expect(cs.isExpanded("/a")).toBe(true)
    expect(cs.visibleNodeIds().has("/a/k0")).toBe(true)
  })

  it("la frontière d'entité reste prioritaire : une entité n'est jamais dépliée par le BFS", () => {
    const g = buildGraph(
      { customers: [{ id: "c1", extra: { x: 1 } }] },
      { ids: { Customer: "$.customers[*].id" } },
    )
    const cs = new CollapseState(g, { initialCardBudget: 10_000 })
    const entity = [...g.nodes.values()].find((n) => n.kind === "entity")!
    expect(cs.isExpanded(entity.id)).toBe(false)
  })

  it("un nœud marqué déplié ne révèle que sa première page (interaction budget × pages)", () => {
    const g = buildGraph(manyItems(250), noConfig)
    const cs = new CollapseState(g) // 250 cartes > 100 mais budget 300 : marqué déplié
    expect(cs.visibleNodeIds().has("/items/100")).toBe(false)
  })
})
```

- [ ] **Step 2: Vérifier l'échec** (`initialCardBudget` inconnu)

- [ ] **Step 3: Implémenter le constructeur**

```ts
export const INITIAL_CARD_BUDGET = 300

constructor(graph: Graph, opts: { initialCardBudget?: number } = {}) {
  this.graph = graph
  const budget = opts.initialCardBudget ?? INITIAL_CARD_BUDGET

  // Le BFS historique dépliait tout jusqu'aux frontières d'entités — sans
  // config il n'y a pas d'entités, donc aucun frein, et le document entier
  // partait dans ELK en un appel (16 s à 50k nœuds). Le budget est le second
  // frein : on cesse de MARQUER déplié dès qu'on a « acheté » assez de cartes
  // visibles. Le BFS sert les niveaux hauts d'abord — c'est l'aperçu.
  // Un nœud atteint mais non marqué reste une carte repliée visible.
  let cards = 1 // la racine elle-même
  const queue: NodeId[] = [graph.rootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = graph.nodes.get(id)
    if (!node) continue
    if (node.kind === "entity" && id !== graph.rootId) continue

    // Déplier `id` révèle sa première page d'enfants-cartes : c'est ce que ça
    // coûte au budget. La racine est toujours dépliée — un document qui
    // s'ouvre sur rien du tout n'est pas un aperçu.
    const cost = Math.min(this.cardChildren(id).length, PAGE_SIZE)
    if (id !== graph.rootId && cards + cost > budget) continue
    cards += cost

    this.expanded.add(id)
    if (node.kind === "entity") continue
    // N'enfiler que ce qui peut devenir visible : les élidés (toujours des
    // lignes) et la PREMIÈRE page d'enfants-cartes. Enfiler au-delà ferait
    // dépenser le budget à marquer déplié des nœuds que les pages cachent.
    let cardIndex = 0
    for (const childId of node.childIds) {
      const child = graph.nodes.get(childId)
      if (!child) continue
      if (child.elided) { queue.push(childId); continue }
      if (cardIndex < PAGE_SIZE) queue.push(childId)
      cardIndex++
    }
  }
}
```

Exporter `INITIAL_CARD_BUDGET` depuis `index.ts`.

- [ ] **Step 4: Vert + tout le paquet core** — les tests existants passent (fixtures petites, sous 300).

- [ ] **Step 5: Commit** — `feat(core): budget de depliage initial dans CollapseState`

---

### Task 3: CollapseState — `expandPathTo` traverse les pages

**Files:**
- Modify: `packages/core/src/collapse.ts`
- Modify: `packages/core/test/collapse.test.ts`

**Interfaces:**
- Consumes: `pageOf`, `cardIndexOf`, `revealPage` (Task 1).
- Produces: `expandPathTo(id)` garde sa signature (`NodeId[]`, les ancêtres nouvellement dépliés, root-first) mais révèle EN PLUS, à chaque niveau, la page contenant l'enfant du chemin. Aucun appelant de production (la cascade de `create.ts` fait la sienne) — le contrat sert l'API publique du core et la tâche 7 s'en inspire.

- [ ] **Step 1: Test qui échoue**

```ts
it("expandPathTo révèle la page de chaque maillon du chemin, pas tout le préfixe", () => {
  const g = buildGraph(manyItems(250), noConfig)
  const cs = new CollapseState(g)
  cs.collapse("/items") // repartir d'un tableau replié
  cs.expandPathTo("/items/213/w")
  const visible = cs.visibleNodeIds()
  expect(visible.has("/items/213")).toBe(true)
  expect(visible.has("/items/100")).toBe(false) // la page 1 n'a pas été payée
  expect(cs.revealedPages("/items").has(2)).toBe(true)
  expect(cs.expandPathTo("/items/213/w")).toEqual([]) // idempotent
})
```

- [ ] **Step 2: Vérifier l'échec** (`/items/213` invisible : seule la page 0 est révélée).

- [ ] **Step 3: Implémenter** — dans `expandPathTo`, après la boucle qui déplie les ancêtres, une seconde passe sur les mêmes maillons révèle les pages du chemin :

```ts
// Déplier les ancêtres ne suffit plus : l'enfant du chemin peut vivre sur une
// page non révélée. On révèle la page de CHAQUE maillon — et seulement elle,
// sinon chercher orders[47312] paierait 47313 cartes.
let childId: NodeId | null = id
for (let i = ancestors.length - 1; i >= 0; i--) {
  const parentId = ancestors[i]!  // NB: reconstruire la chaîne complète parent->enfant,
  const idx = this.cardIndexOf(parentId, childId!)
  if (idx >= 0) this.revealPage(parentId, pageOf(idx))
  childId = parentId
}
```

Attention : `ancestors` dans le code actuel ne contient que les ancêtres **non encore dépliés** — pour les pages il faut la chaîne complète des parents (un parent déjà déplié peut avoir la mauvaise page). Reconstruire la chaîne entière depuis `id` (comme la boucle `while (parentId !== null)` du haut de la méthode) et appliquer `revealPage` sur chaque couple (parent, enfant-sur-le-chemin) dont l'indice est un enfant-carte.

- [ ] **Step 4: Vert + paquet core.**

- [ ] **Step 5: Commit** — `feat(core): expandPathTo revele la page de chaque maillon du chemin`

---

### Task 4: structure-layout — `layoutAfterReveal` et purge des deltas par `layout()`

**Files:**
- Modify: `packages/core/src/structure-layout.ts`
- Modify: `packages/core/test/structure-layout.test.ts` (ou le fichier de test existant du moteur — le repérer par `grep -rn "layoutAfterExpand" packages/core/test`)
- Modify: `packages/core/src/index.ts` si le type `StructureLayoutEngine` y est réexporté (vérifier)

**Interfaces:**
- Consumes: `CollapseState` non — le moteur reste sans dépendance à l'état de pli ; il reçoit `visible` calculé par l'appelant, comme aujourd'hui.
- Produces (la tâche 6 s'appuie dessus) :

```ts
layoutAfterReveal(
  prev: LayoutResult,
  graph: Graph,
  parentId: NodeId,
  visible: Set<NodeId>,
  metrics?: NodeMetrics,
): Promise<LayoutResult>
```

Sémantique : les nouveaux visibles (`visible` moins les clés de `prev.positions`, hors élidés) sont mis en page en isolation (même config ELK, même remappage d'arêtes que `layoutAfterExpand`), puis **insérés verticalement** dans la colonne des enfants déjà posés de `parentId` :

- point d'insertion `anchorY` : s'il existe des enfants-cartes de `parentId` déjà posés AVANT le premier nouveau (dans l'ordre de `childIds`), `anchorY = bas de la dernière carte de ce bloc + 24` et `colX = son x` ; sinon s'il en existe APRÈS, `anchorY = haut de la première carte de ce bloc` et `colX = son x` ; sinon retomber sur `anchorRectFor(graph, prev.positions, parentId, metrics)` avec la pose latérale de `layoutAfterExpand` (`x + width + 48`, `y`).
- décalage : tout rect de `prev.positions` avec `y ≥ anchorY` descend de `delta = hauteurBBoxDuBloc + 24`.
- mémorisation pour le repli : **accumuler** dans `expansionDeltas` sous la clé `parentId` — `delta` sommé, `thresholdY` le min — plutôt qu'écraser. Commentaire : approximation assumée de l'incrémental (même famille que celle documentée en tête de `layoutAfterCollapse`), c'est `tidy()` qui répare.
- no-op défensif : si l'ensemble « nouveaux visibles » est vide (reveal d'une page d'un nœud replié, appel redondant), rendre une copie de `prev` sans rien poser ni décaler — même politique que la branche no-op de `layoutAfterExpand`.
- `layout()` (le global) **vide `expansionDeltas`** : après une mise en page globale, les décalages passés référencent des positions qui n'existent plus ; les annuler ensuite corromprait la vue.

- [ ] **Step 1: Tests qui échouent** (dans le fichier de test du moteur ; fabriquer graphe + visibles à la main comme les tests existants du moteur le font — les lire d'abord) :

```ts
it("layoutAfterReveal insère le nouveau bloc sous le bloc précédent et décale le dessous", async () => {
  const g = buildGraph(manyItems(250), { ids: {} })
  const cs = new CollapseState(g)
  const engine = createStructureLayoutEngine()
  const before = await engine.layout(g, cs.visibleNodeIds())
  const lastOfPage0 = before.positions.get("/items/99")!
  cs.revealPage("/items", 1)
  const after = await engine.layoutAfterReveal(before, g, "/items", cs.visibleNodeIds())
  const first = after.positions.get("/items/100")!
  expect(first.x).toBeCloseTo(lastOfPage0.x, 1)          // même colonne
  expect(first.y).toBeGreaterThan(lastOfPage0.y)          // dessous
  // une carte qui était sous le point d'insertion a été décalée d'au moins la
  // hauteur du bloc — prendre une carte hors de /items posée plus bas si la
  // fixture en a une, sinon vérifier que /items/99 n'a pas bougé :
  expect(after.positions.get("/items/99")!.y).toBeCloseTo(lastOfPage0.y, 1)
})

it("layoutAfterReveal d'un bloc disjoint sans précédent se pose au-dessus du bloc suivant", async () => {
  const g = buildGraph(manyItems(250), { ids: {} })
  const cs = new CollapseState(g)
  cs.unrevealPage("/items", 0)
  cs.revealPage("/items", 2)
  const engine = createStructureLayoutEngine()
  const only = await engine.layout(g, cs.visibleNodeIds())
  const topOf2 = [...cs.visibleNodeIds()].filter((i) => i.startsWith("/items/2")).length
  expect(topOf2).toBeGreaterThan(0)
  cs.revealPage("/items", 0)
  const after = await engine.layoutAfterReveal(only, g, "/items", cs.visibleNodeIds())
  expect(after.positions.get("/items/0")).toBeDefined()
  expect(after.positions.get("/items/0")!.y).toBeLessThan(after.positions.get("/items/200")!.y)
})

it("layout() global purge la mémoire de deltas : un collapse ultérieur n'annule rien", async () => {
  // dérouler expand -> layout global -> collapse et vérifier qu'aucune carte
  // étrangère n'a bougé après le collapse (positions identiques hors sous-arbre replié)
})
```

Écrire le troisième test en entier (pas un squelette) en s'appuyant sur les helpers du fichier de test existant.

- [ ] **Step 2: Vérifier l'échec** (`layoutAfterReveal` n'existe pas).

- [ ] **Step 3: Implémenter** — extraire de `layoutAfterExpand` un helper interne partagé :

```ts
/** Pose `newlyVisible` en isolation (même config ELK, arêtes remappées dans le
 * périmètre), rend le bloc brut + sa bbox. Partagé par expand et reveal : la
 * mécanique delta/threshold doit rester UNIQUE, c'est l'invariant de la spec. */
async function layoutIsolatedBlock(graph, newlyVisible, visible, metrics) { ... }
```

`layoutAfterExpand` garde exactement son comportement actuel (mêmes tests verts). `layoutAfterReveal` implémente l'insertion décrite dans **Produces**. `layout()` gagne `expansionDeltas.clear()` en tête.

- [ ] **Step 4: Vert + paquet core entier** (non-régression des tests moteur existants).

- [ ] **Step 5: Commit** — `feat(core): layoutAfterReveal — insertion incrementale d'une page revelee`

---

### Task 5: maxNodes — défaut relevé au bench, message enrichi

**Files:**
- Modify: `packages/core/src/config.ts:181` (défaut)
- Modify: `packages/core/src/model.ts:158` (message)
- Modify: `packages/core/test/config.test.ts:30` (nouvelle valeur)
- Modify: `packages/core/bench/bench.ts` (mesure d'échelle additive)

**Interfaces:** aucun changement de signature.

- [ ] **Step 1: Bench d'abord** — ajouter à `bench.ts` (après les mesures existantes, même style `report`) une boucle `for (const n of [100_000, 500_000, 1_000_000])` qui mesure `buildGraph` + `buildSearchIndex` sur `bigShop(n)` avec `maxNodes: Number.MAX_SAFE_INTEGER` dans la config, et imprime durée + `process.memoryUsage().heapUsed`. Lancer `pnpm --filter @defsquare/data-graph-core bench`.

- [ ] **Step 2: Fixer le défaut selon la mesure** — si 1 M tient sous ~1,5 Go de heap et ~5 s de build+index : `1_000_000`. Sinon la plus grande valeur de {500_000, 250_000, 100_000} qui tient, et **amender la ligne « cible 1 M » de la spec** avec la valeur retenue et la mesure.

- [ ] **Step 3: Test** — mettre à jour `config.test.ts:30` (`expect(v.maxNodes).toBe(<valeur>)`), et ajouter un test du message :

```ts
it("GraphTooLargeError dit comment relever le plafond", () => {
  expect(() => buildGraph(bigShop(2000), { ...shopConfig, maxNodes: 100 }))
    .toThrow(/maxNodes.*config/)
})
```

- [ ] **Step 4: Implémenter** — `config.ts:181` : nouveau défaut. `model.ts:158` :

```ts
super(`Graph exceeds maxNodes: ${count} > ${max} — relevez "maxNodes" dans la config (option -c de la CLI)`)
```

- [ ] **Step 5: Vert + commit** — `feat(core): maxNodes redevient une garde memoire — defaut releve, message actionnable`

---

### Task 6: Renderer — jetons reliquat et `doReveal`

**Files:**
- Modify: `packages/renderer/src/draw.ts` (fonction pure de dessin du jeton)
- Modify: `packages/renderer/src/create.ts` (calque des jetons, `doReveal`, reconstruction)
- Test: `packages/renderer/test/draw.test.ts` (ou fichier équivalent existant — repérer où les fonctions de `draw.ts` sont testées)

**Interfaces:**
- Consumes: `CollapseState.hiddenGaps/revealPage/unrevealPage` (Task 1), `engine.layoutAfterReveal` (Task 4).
- Produces: `drawRemainderToken(opts: { count: number; width: number; theme: <type thème existant de draw.ts> }): Container` — donnée nue uniquement, libellé `+ ${count}`. Dans `create.ts` : `async function doReveal(parentId: NodeId, page: number): Promise<void>`.

- [ ] **Step 1: Lire** `draw.ts` en entier (le style : fonctions pures, `Container` retourné, métriques/thème en paramètres — voir le jeton de ligne existant vers `draw.ts:187-259`) et la passe de reconstruction `rebuild()` (`create.ts:1613`) pour situer où les calques sont repeints.

- [ ] **Step 2: Test qui échoue** pour `drawRemainderToken` (même style que les tests existants de `draw.ts` : construire, inspecter labels/enfants) : le container porte un label `remainder-token`, contient un texte `+ 47 300`, et sa largeur suit `opts.width`.

- [ ] **Step 3: Implémenter `drawRemainderToken`** dans `draw.ts`, en réutilisant les mêmes primitives visuelles que le jeton de ligne (fond, texte, chevron si le style s'y prête). Vert.

- [ ] **Step 4: Câbler dans `create.ts`** :

1. **Calque** : un `Container` dédié `remainderLayer` ajouté au monde près des cartes ; `rebuild()` le vide puis, pour chaque nœud visible ET déplié dont `collapseState.hiddenGaps(id)` est non vide, pose un jeton par trou. Position par arithmétique (pas d'ELK) :
   - bloc précédent existant (cartes d'indices `< fromIndex` posées) → sous la dernière : `x = rect.x`, `y = rect.y + rect.height + 8` ;
   - sinon bloc suivant → au-dessus de la première : `x = rect.x`, `y = rect.y - hauteurJeton - 8` ;
   - sinon (rien de posé — ne devrait pas arriver pour un nœud déplié visible) : ne rien dessiner.
   - largeur : celle de la carte voisine utilisée pour l'ancrage.
2. **Interaction** : `eventMode = "static"`, `cursor = "pointer"`, `pointertap` → `void doReveal(id, gap.nextPage)`.
3. **`doReveal`** — calqué sur `doExpand` (`create.ts:2104`), même discipline `opGen` + retour arrière :

```ts
async function doReveal(parentId: NodeId, page: number): Promise<void> {
  if (!graph || !collapseState || !layoutResult || !engine) return;
  if (collapseState.revealedPages(parentId).has(page)) return;
  const gen = ++opGen;
  collapseState.revealPage(parentId, page);
  const visible = collapseState.visibleNodeIds();
  const prevPositions = new Map(layoutResult.positions);
  const next = await engine.layoutAfterReveal(layoutResult, graph, parentId, visible, metrics);
  if (destroyed || gen !== opGen) {
    // Même retour arrière que doExpand, même raison : collapseState ne doit
    // jamais devancer layoutResult (voir le commentaire de doExpand).
    collapseState.unrevealPage(parentId, page);
    return;
  }
  layoutResult = next;
  rebuild();
  animatePositions(prevPositions, layoutResult.positions);
}
```

- [ ] **Step 5: Vérifier** — `pnpm --filter @defsquare/data-graph test` (paquet renderer entier) + `pnpm typecheck`.

- [ ] **Step 6: Commit** — `feat(renderer): jetons reliquat et revelation de page au clic`

---

### Task 7: Renderer — la cascade de `doFocus` traverse les pages

**Files:**
- Modify: `packages/renderer/src/create.ts:2275-2316` (cascade)

**Interfaces:**
- Consumes: `pageOf`, `PAGE_SIZE` (import depuis `@defsquare/data-graph-core`), `collapseState.cardIndexOf/revealedPages/revealPage/unrevealPage`, `engine.layoutAfterReveal`.

- [ ] **Step 1: Étendre la collecte** — la cascade actuelle collecte les ancêtres repliés. La remplacer par une collecte d'**étapes** typées, en remontant la chaîne complète des parents (pas seulement les repliés) :

```ts
type FocusStep =
  | { kind: "expand"; id: NodeId }
  | { kind: "reveal"; parentId: NodeId; page: number };

const steps: FocusStep[] = [];
let childOnPath: NodeId = id;
let node = graph.nodes.get(id);
let parentId = node?.parentId ?? null;
while (parentId !== null) {
  // `reverse()` renverse AUSSI l'ordre intra-niveau : pour exécuter expand
  // AVANT reveal à chaque niveau (révéler une page d'un nœud encore replié ne
  // montre rien), on pousse reveal d'abord ici.
  const idx = collapseState.cardIndexOf(parentId, childOnPath);
  if (idx >= 0 && !collapseState.revealedPages(parentId).has(pageOf(idx))) {
    steps.push({ kind: "reveal", parentId, page: pageOf(idx) });
  }
  if (!collapseState.isExpanded(parentId)) steps.push({ kind: "expand", id: parentId });
  childOnPath = parentId;
  node = graph.nodes.get(parentId);
  parentId = node?.parentId ?? null;
}
steps.reverse(); // root-first, expand avant reveal à chaque niveau
```

- [ ] **Step 2: Exécuter pas-à-pas** — la boucle existante devient une boucle sur `steps`, chaque étape gardant la discipline actuelle (mutation, await du layout, retour arrière de LA SEULE étape en vol si supersédée) :

```ts
for (const step of steps) {
  if (destroyed || gen !== opGen) return;
  if (step.kind === "expand") collapseState.expand(step.id);
  else collapseState.revealPage(step.parentId, step.page);
  const next = step.kind === "expand"
    ? await engine.layoutAfterExpand(layoutResult, graph, step.id, collapseState.visibleNodeIds(), metrics)
    : await engine.layoutAfterReveal(layoutResult, graph, step.parentId, collapseState.visibleNodeIds(), metrics);
  if (destroyed) return;
  if (gen !== opGen) {
    if (step.kind === "expand") collapseState.collapse(step.id);
    else collapseState.unrevealPage(step.parentId, step.page);
    return;
  }
  layoutResult = next;
}
```

Garder tel quel le garde d'entrée (`!visibleNodeIds().has(id)`), le `rebuild()` final et le cadrage `anchorRectFor` en dessous. Adapter le commentaire de tête : la cascade ouvre désormais aussi les pages.

- [ ] **Step 3: Vérifier** — tests renderer + `pnpm typecheck`. La couverture comportementale de bout en bout vient de la tâche 9.

- [ ] **Step 4: Commit** — `feat(renderer): la cascade de focus revele la page de chaque maillon`

---

### Task 8: `tidy()` public + bouton « Ranger »

**Files:**
- Modify: `packages/renderer/src/create.ts` (API publique — l'interface vers `create.ts:256` et l'implémentation vers `create.ts:2579`)
- Modify: `apps/demo/index.html` (bouton, à côté de `fit`) et `apps/demo/src/chrome.ts:216` (câblage)

**Interfaces:**
- Produces: `tidy(): Promise<void>` sur l'instance publique (déclarer dans l'interface où vivent `fit()`, `expand()`, …).

- [ ] **Step 1: Implémenter `tidy`** dans `create.ts`, à côté de `fit()` :

```ts
async tidy(): Promise<void> {
  // Vue structure seulement : la vue graphe a son propre moteur deux niveaux
  // et ne dérive pas — un tidy n'y aurait rien à réparer.
  if (destroyed || view === "graph") return;
  if (!graph || !collapseState || !engine || !layoutResult) return;
  const gen = ++opGen;
  const prevPositions = new Map(layoutResult.positions);
  const visible = collapseState.visibleNodeIds();
  // Le chemin GLOBAL : l'ensemble visible est borné par budget + pages, donc
  // ce layout est bon marché — c'est toute la raison d'être du bouton.
  // layout() purge la mémoire de deltas : la mise en page globale est la
  // nouvelle vérité, les décalages passés n'ont plus à être annulables.
  const next = await engine.layout(graph, visible, metrics);
  if (destroyed || gen !== opGen) return;
  layoutResult = next;
  rebuild();
  animatePositions(prevPositions, layoutResult.positions);
  doFit();
},
```

Vérifier les noms réels (`doFit`, `animatePositions`, `metrics`) dans le fichier ; suivre le style des méthodes publiques voisines (gardes `destroyed`).

- [ ] **Step 2: Bouton démo** — dans `index.html`, dupliquer le bouton `fit` en `id="tidy"`, libellé « Ranger » ; dans `chrome.ts` à côté de la ligne 216 :

```ts
document.getElementById("tidy")?.addEventListener("click", () => void graph.tidy());
```

- [ ] **Step 3: Vérifier** — `pnpm typecheck`, tests renderer, `pnpm --filter demo e2e` (non-régression : aucun spec existant ne touche `tidy`).

- [ ] **Step 4: Commit** — `feat: tidy() — remise en page globale a la demande, bouton Ranger dans la demo`

---

### Task 9: E2E — gros document, jetons, recherche profonde, Ranger

**Files:**
- Create: `apps/demo/e2e/structure-scale.spec.ts`

**Interfaces:** consomme l'API `window.__graph` exposée par la démo (voir `apps/demo/e2e/culling.spec.ts:34-53` pour le modèle : `setData`, `search` — vérifier les méthodes exposées —, `focus`, `stats`).

- [ ] **Step 1: Écrire le spec** sur le modèle des e2e existants (mêmes helpers `goto`/`poll`) :

```ts
import { test, expect } from "@playwright/test"

// ~10k nœuds logiques suffisent à prouver la politique sans ralentir la CI :
// 3000 éléments objets = 30x PAGE_SIZE, très au-dessus du budget initial.
const data = {
  items: Array.from({ length: 3000 }, (_, i) => ({ id: `it${i}`, name: `Item ${i}` })),
}

test("un gros document s'ouvre replié et se pagine au clic", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => (window as any).__graph !== undefined)
  await page.evaluate(() => (window as any).__graph.ready)
  await page.evaluate(async (d: any) => (window as any).__graph.setData(d, { ids: {} }), data)
  // L'ensemble visible est borné : très en dessous du total logique.
  const stats = await page.evaluate(() => (window as any).__graph.stats())
  expect(stats.visibleNodeCount).toBeLessThan(500)
  expect(stats.logicalNodeCount).toBeGreaterThan(5000)
})

test("la recherche révèle une page profonde et centre la cible", async ({ page }) => {
  // setData comme ci-dessus, puis :
  // - search("Item 2777") via l'API publique (vérifier son nom exact dans create.ts:267)
  // - nextMatch/step pour déclencher le focus (vérifier le nom exposé)
  // - poll : stats().visibleNodeCount reste borné (< 800) ET le nœud est visible
  //   (l'e2e culling montre comment prouver la présence par le clic au centre)
})

test("Ranger garde une vue cohérente", async ({ page }) => {
  // ouvrir, cliquer #tidy, vérifier qu'un clic au centre sélectionne toujours
  // une carte (hit-test vivant) et que stats() n'a pas bougé.
})
```

Écrire les trois tests EN ENTIER en recopiant les mécanismes des specs existants (`culling.spec.ts` pour le hit-test central, `smoke.spec.ts` pour l'API publique réelle — en particulier les noms exacts des méthodes de recherche).

- [ ] **Step 2: Lancer** — `pnpm --filter demo e2e structure-scale.spec.ts` ; itérer jusqu'au vert.

- [ ] **Step 3: Suite complète** — `pnpm --filter demo e2e` (les 33 specs existants + les nouveaux) et `pnpm test` racine.

- [ ] **Step 4: Commit** — `test(e2e): gros document — ouverture bornee, pagination, recherche profonde, Ranger`

---

### Task 10: Documentation et vérification finale

**Files:**
- Modify: `README.md` racine (section budgets/limites si elle mentionne 50 000 — `grep -rn "50" README.md packages/*/README.md apps/demo/README.md`)
- Modify: `apps/demo/README.md` si la CLI y documente le plafond

- [ ] **Step 1: Mettre à jour** toute mention du plafond 50 000 et documenter en une phrase chacun : l'aperçu replié, les jetons de page, le bouton Ranger.

- [ ] **Step 2: Vérification complète** — `pnpm typecheck && pnpm build && pnpm test && pnpm --filter demo e2e`. Tout doit être vert ; ne rien déclarer terminé sans la sortie.

- [ ] **Step 3: Commit** — `docs: aperçu replié, pagination et nouveau plafond maxNodes`
