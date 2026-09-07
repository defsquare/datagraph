import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { buildGraph } from "../src/build.js"
import { buildAggregates } from "../src/aggregate.js"
import { validateConfig, type DataGraphConfig } from "../src/config.js"
import {
  createTwoLevelLayoutEngine,
  extractGraphLayoutInput,
  layoutFromInput,
  type GraphLayoutResult,
} from "../src/graph-layout.js"
import {
  shopConfig,
  bigShop,
  deepAggregate,
  deepAggregateConfig,
  denseRefs,
  denseRefsConfig,
} from "./fixtures.js"

/**
 * LE TEST DE NON-RÉGRESSION DE LA SCISSION extraction / cœur pur.
 *
 * `createTwoLevelLayoutEngine` a été coupé en deux — `extractGraphLayoutInput`,
 * qui est la seule partie qui lit le `Graph`, et `layoutFromInput`, qui est tout
 * le calcul et ne connaît qu'un objet plat sérialisable (voir l'en-tête de
 * `graph-layout.ts`). C'était du code RÉORDONNÉ, pas une réécriture : la
 * promesse tenue ici est que les positions sortent IDENTIQUES AU BIT PRÈS.
 *
 * Cette promesse n'est pas de la coquetterie. Toute la documentation du moteur
 * — les tableaux de calibrage de `TWO_LEVEL_LAYOUT_DEFAULTS`, les mesures de
 * remplissage, les écarts-types de voisinage — a été mesurée sur une sortie
 * précise, et les tests de déterminisme (`graph-layout.test.ts`) exigent qu'un
 * même graphe rende deux fois la même chose. Un écart d'un ulp quelque part
 * dans la simulation, et cet écosystème de chiffres cesse silencieusement de
 * décrire le moteur.
 *
 * COMMENT LA PREUVE EST FAITE, et pourquoi ce n'est pas un instantané à
 * rafraîchir : les trois empreintes ci-dessous ont été CAPTURÉES SUR
 * L'IMPLÉMENTATION D'AVANT LA SCISSION, avant que la moindre ligne du moteur
 * ne bouge, et n'ont pas été retouchées depuis. Elles ne disent donc pas « voilà
 * ce que le moteur produit aujourd'hui » mais « voilà ce que le moteur
 * produisait avant qu'on y touche ». Une empreinte qui rougit signale un
 * CHANGEMENT DE SORTIE ; si ce changement est voulu (un réglage qu'on assume de
 * bouger), c'est tout le corpus de mesures du fichier qu'il faut remesurer, et
 * la ligne se met alors à jour EN MÊME TEMPS que ces mesures. La remettre à
 * jour seule pour faire passer la suite est exactement l'erreur que ce test
 * existe pour rendre visible.
 *
 * Trois fixtures, parce qu'ils exercent trois chemins disjoints du moteur :
 *  - `bigShop(3000)` — 167 agrégats plats, ZÉRO référence inter-agrégat : le
 *    packing en ÉTAGÈRES et le niveau 2 réduit à gravité + collision ;
 *  - `deepAggregate()` — un agrégat profond de 41 cartes : le packing RADIAL,
 *    donc l'adjacence inverse intra-cluster, qui est justement ce que
 *    l'extraction doit transporter sans le déformer ;
 *  - `denseRefs()` — 80 disques, degré inter-cluster 12 : les RESSORTS du
 *    niveau 2, donc l'ordre et la multiplicité de `refs`, que l'extraction
 *    aplatit depuis `graph.refEdges` et dont dépend le poids de chaque ressort.
 */

const shopGroupsConfig: DataGraphConfig = { ...shopConfig, groups: ["Customer"] }

function setupOn(data: unknown, cfg: DataGraphConfig) {
  const graph = buildGraph(data, cfg)
  const aggregates = buildAggregates(graph, validateConfig(cfg))
  const visible = new Set(
    [...graph.nodes.values()].filter((n) => n.kind === "entity").map((n) => n.id),
  )
  return { graph, aggregates, visible }
}

/**
 * L'empreinte d'une mise en page, à PLEINE PRÉCISION.
 *
 * `toExponential(17)` et non `String(x)` : deux doubles distincts peuvent
 * partager leur écriture décimale courte, et c'est précisément l'écart qu'on
 * cherche à interdire ici. Les positions sont triées par id — l'ordre
 * d'insertion de la `Map` n'est pas ce qu'on garde — et les enveloppes sont
 * prises dans l'ordre du moteur, qui, lui, EST un résultat.
 */
function digestOf(result: GraphLayoutResult): string {
  const hash = createHash("sha256")
  const num = (x: number): string => x.toExponential(17)
  for (const id of [...result.positions.keys()].sort()) {
    const rect = result.positions.get(id)!
    hash.update(`${id}|${num(rect.x)}|${num(rect.y)}|${num(rect.width)}|${num(rect.height)}\n`)
  }
  for (const cluster of result.clusters) {
    hash.update(
      `${cluster.aggregateId}|${cluster.rootId}|${num(cluster.cx)}|${num(cluster.cy)}|${num(cluster.r)}\n`,
    )
  }
  return hash.digest("hex")
}

const CASES: { name: string; data: unknown; config: DataGraphConfig; digest: string }[] = [
  {
    name: "bigShop(3000) — étagères, aucun ressort",
    data: bigShop(3000),
    config: shopGroupsConfig,
    digest: "9b47dfc74e2e8e61d6ed7268c0e21df4579a543ca8704e2ec1d7a35b08dc5113",
  },
  {
    name: "deepAggregate() — packing radial",
    data: deepAggregate(),
    config: deepAggregateConfig,
    digest: "a893d3ba3c05f653ddb2fcd56ba4d9f3c5afeac756ce36712dd511d69af72894",
  },
  {
    name: "denseRefs() — ressorts inter-agrégats",
    data: denseRefs(),
    config: denseRefsConfig,
    digest: "d583f911ddf5f29f5f8a918f9d3e3fe66e7b2f73a471c1406c1b20d91aa738b1",
  },
]

describe("scission extraction / cœur pur — identité bit-près", () => {
  for (const { name, data, config, digest } of CASES) {
    it(`${name} : le moteur rend exactement la sortie d'avant la scission`, async () => {
      const { graph, aggregates, visible } = setupOn(data, config)
      const result = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      expect(digestOf(result)).toBe(digest)
    })

    it(`${name} : extraction puis cœur pur rendent la MÊME chose que le moteur`, async () => {
      const { graph, aggregates, visible } = setupOn(data, config)
      const viaEngine = await createTwoLevelLayoutEngine().layout(graph, aggregates, visible)
      const viaInput = layoutFromInput(extractGraphLayoutInput(graph, aggregates, visible))

      // La comparaison porte sur les nombres eux-mêmes, pas sur l'empreinte :
      // c'est ce qui rend le diff lisible quand elle casse.
      expect([...viaInput.positions.entries()].sort()).toEqual(
        [...viaEngine.positions.entries()].sort(),
      )
      expect(viaInput.clusters).toEqual(viaEngine.clusters)
    })
  }
})

describe("extractGraphLayoutInput — ce qui traverse, et rien d'autre", () => {
  const { graph, aggregates, visible } = setupOn(bigShop(600), shopGroupsConfig)

  it("ne retient des entités que leur id et la taille de leur carte", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)

    // Une entité par nœud VISIBLE de type entité, et rien d'autre : ni racine,
    // ni tableau, ni objet.
    const entityCount = [...graph.nodes.values()].filter((n) => n.kind === "entity").length
    expect(input.entities).toHaveLength(entityCount)
    // Trié : c'est une CONDITION du déterminisme du moteur, pas un confort de
    // lecture — l'ordre de `visible` est celui d'un `Set` construit par
    // l'appelant.
    expect(input.entities.map((e) => e.id)).toEqual([...input.entities.map((e) => e.id)].sort())
    for (const entity of input.entities) {
      expect(Object.keys(entity).sort()).toEqual(["h", "id", "w"])
      expect(entity.w).toBeGreaterThan(0)
      expect(entity.h).toBeGreaterThan(0)
    }
  })

  it("ne retient des références que les paires (source, cible) qui relient deux entités placées", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    const placed = new Set(input.entities.map((e) => e.id))

    // Une paire PAR référence, doublons compris : c'est la multiplicité qui
    // fait le poids des ressorts du niveau 2.
    const kept = graph.refEdges.filter(
      (e) => e.to !== null && !e.dangling && placed.has(e.fromEntity) && placed.has(e.to),
    )
    expect(input.refs).toHaveLength(kept.length)
    expect(input.refs).toEqual(kept.map((e) => ({ from: e.fromEntity, to: e.to })))
    // Anti-test-creux : le fixture doit réellement porter des références.
    expect(input.refs.length).toBeGreaterThan(0)
  })

  it("ne retient des agrégats que leur id, leur racine et leurs membres visibles", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    for (const agg of input.aggregates) {
      expect(Object.keys(agg).sort()).toEqual(["id", "memberIds", "rootId"])
      expect(agg.rootId).toBe(aggregates.aggregates.get(agg.id)!.rootId)
      for (const memberId of agg.memberIds) {
        expect(aggregates.byNode.get(memberId)?.[0]).toBe(agg.id)
      }
    }
    expect(input.aggregates.length).toBeGreaterThan(0)
  })

  it("ne laisse fuir AUCUNE référence au graphe : l'entrée survit à un structured clone", () => {
    const input = extractGraphLayoutInput(graph, aggregates, visible)
    // La vraie propriété recherchée, et la seule qui compte pour le worker :
    // l'objet passe le clonage structuré. Un `Graph`, un `GraphNode` ou une
    // `Map` de nœuds qui aurait fui s'y verrait — les fonctions que les nœuds
    // ne portent pas encore, non, mais le POIDS, lui, se verrait tout de suite.
    const clone = structuredClone(input)
    expect(clone).toEqual(input)
    // Et le clone suffit à mettre en page : c'est la preuve de bout en bout que
    // rien du graphe n'est nécessaire au-delà de l'extraction.
    expect(layoutFromInput(clone).positions.size).toBe(input.entities.length)
  })

  it("porte les options RÉSOLUES, défauts compris", () => {
    const withDefaults = extractGraphLayoutInput(graph, aggregates, visible)
    expect(withDefaults.options.hullPadding).toBe(18)
    expect(withDefaults.options.clusterGap).toBe(160)

    const tuned = extractGraphLayoutInput(graph, aggregates, visible, undefined, { clusterGap: 42 })
    expect(tuned.options.clusterGap).toBe(42)
    // Les autres restent aux défauts : le cœur pur ne les relit nulle part.
    expect(tuned.options.hullPadding).toBe(18)
  })
})
