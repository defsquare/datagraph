import { describe, it, expect } from "vitest"
import { buildGraph } from "../src/build.js"
import { CollapseState } from "../src/collapse.js"
import { createStructureLayoutEngine } from "../src/structure-layout.js"
import { buildSearchIndex } from "../src/search.js"
import { arrayTokenTextFor, badgeTextFor, measureNode, DEFAULT_METRICS } from "../src/measure.js"
import { nearestDrawn, VALUE_ONLY_KEY, type ArrayRow } from "../src/model.js"
import type { DataGraphConfig } from "../src/config.js"

/**
 * Un tableau n'est plus une CARTE mais une LIGNE de la carte de son parent, et
 * ses elements sont des cartes. Ce fichier couvre ce que ce basculement a de non
 * evident : qui est elide et qui ne l'est pas, ou passe le contenu du tableau
 * dans l'index de recherche, et comment les aretes de containment sont
 * remappees quand leur extremite n'a plus de boite.
 */

const config: DataGraphConfig = {
  ids: { Product: "$.products[*].id" },
}

/** Un chemin d'identite qui ne matche rien dans les jeux ci-dessous : le graphe
 * n'a donc AUCUNE entite — exactement ce que ces cas veulent observer, sans
 * dependre du fait qu'une carte `ids` vide soit acceptee. */
const NO_ENTITIES: DataGraphConfig = {
  ids: { Absente: "$.absente[*].id" },
}

const data = {
  products: [
    {
      id: "p1",
      name: "Clavier",
      tags: ["mecanique", "USB-C"],
      reviews: [{ author: "Camille", rating: 5 }],
    },
  ],
}

describe("elision d'un tableau", () => {
  const g = buildGraph(data, config)

  it("remplace la carte du tableau par une ligne sur son parent", () => {
    const product = g.nodes.get("/products/0")!
    const row = product.rows.find((r) => r.key === "tags") as ArrayRow | undefined
    expect(row).toBeDefined()
    expect(row!.valueType).toBe("array")
    expect(row!.value).toBe(2)
    expect(row!.arrayId).toBe("/products/0/tags")
    expect(g.nodes.get("/products/0/tags")!.elided).toBe(true)
  })

  it("range la ligne dans l'ordre des cles de l'objet, pas en fin de carte", () => {
    // `tags` est declare apres `name` dans la donnee : la ligne doit s'y
    // trouver aussi. Elle est posee APRES la visite de l'enfant, seul moment ou
    // le nombre d'elements est connu, d'ou le risque de la voir filer en fin de
    // liste.
    const keys = g.nodes.get("/products/0")!.rows.map((r) => r.key)
    expect(keys).toEqual(["id", "name", "tags", "reviews"])
  })

  it("fait de chaque element scalaire un nœud a valeur seule", () => {
    const tag = g.nodes.get("/products/0/tags/0")!
    expect(tag.label).toBe("tags[0]")
    expect(tag.rows).toEqual([{ key: VALUE_ONLY_KEY, value: "mecanique", valueType: "string" }])
    expect(tag.elided).toBe(false)
  })

  it("n'elide PAS un document racine qui est un tableau nu", () => {
    // Sans parent pour porter la ligne, l'elider ne laisserait aucune carte.
    const bare = buildGraph([1, 2], NO_ENTITIES)
    expect(bare.nodes.get("/")!.elided).toBe(false)
  })

  it("n'elide PAS un tableau dont le parent est deja elide", () => {
    // Meme raison : la carte hote manque. Le tableau interieur reprend donc la
    // sienne, et c'est le seul cas ou un tableau se dessine encore en carte.
    const nested = buildGraph({ matrix: [[1, 2]] }, NO_ENTITIES)
    expect(nested.nodes.get("/matrix")!.elided).toBe(true)
    expect(nested.nodes.get("/matrix/0")!.elided).toBe(false)
  })
})

describe("compte d'enfants dessines", () => {
  it("exclut les enfants elides du chevron et de la pastille", () => {
    // Les deux seuls enfants du produit sont des tableaux : son en-tete n'a rien
    // a reveler, donc ni chevron ni pastille. Avec `childIds.length` il aurait
    // annonce « 2 » et un pli sans effet.
    const g = buildGraph(data, config)
    const product = g.nodes.get("/products/0")!
    expect(product.childIds.length).toBe(2)
    expect(product.cardChildCount).toBe(0)

    // La pastille d'une ENTITE porte son type, jamais un compte : c'est sur un
    // conteneur ordinaire que l'exclusion des elides s'observe.
    const plain = buildGraph({ box: { tags: ["a"] } }, NO_ENTITIES).nodes.get("/box")!
    expect(plain.childIds.length).toBe(1)
    expect(plain.cardChildCount).toBe(0)
    expect(badgeTextFor(plain)).toBe("")
  })
})

describe("visibilite d'un tableau elide", () => {
  const g = buildGraph(data, config)
  const cs = new CollapseState(g)

  it("expose la ligne meme quand la carte hote est repliee", () => {
    // Une entite demarre repliee. Sa ligne `tags` est pourtant dessinee — les
    // lignes le sont toujours — donc le nœud qu'elle pilote doit exister pour le
    // pli, sans quoi le clic sur le jeton ne deplierait rien.
    expect(cs.isExpanded("/products/0")).toBe(false)
    expect(cs.visibleNodeIds().has("/products/0/tags")).toBe(true)
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(false)
  })

  it("revele les elements des que le tableau lui-meme est deplie", () => {
    cs.expand("/products/0/tags")
    expect(cs.visibleNodeIds().has("/products/0/tags/0")).toBe(true)
  })
})

describe("index de recherche", () => {
  const index = buildSearchIndex(buildGraph(data, config))

  it("n'indexe pas le compte d'elements comme une valeur", () => {
    // Sinon « items » correspondrait a TOUS les tableaux du document, et « 2 » a
    // tout tableau de deux elements.
    expect(index.search("items")).toEqual([])
  })

  it("trouve le contenu reel la ou il vit desormais, sur les elements", () => {
    const hits = index.search("mecanique")
    expect(hits.map((h) => h.nodeId)).toContain("/products/0/tags/0")
  })

  it("indexe toujours la CLE du tableau", () => {
    expect(index.search("tags").map((h) => h.nodeId)).toContain("/products/0")
  })
})

describe("remappage des aretes de containment", () => {
  it("resout une extremite elidee vers son plus proche ancetre dessine", () => {
    const g = buildGraph(data, config)
    expect(nearestDrawn(g, "/products/0/tags")).toBe("/products/0")
    expect(nearestDrawn(g, "/products/0/tags/0")).toBe("/products/0/tags/0")
  })

  it("remonte PLUSIEURS crans d'elision, pas un seul", () => {
    // Un tableau dans un tableau elide : c'est le cas qu'une resolution a un
    // niveau rate, en s'arretant sur un nœud qui n'a toujours pas de carte.
    const g = buildGraph({ a: [[[1]]] }, NO_ENTITIES)
    expect(g.nodes.get("/a")!.elided).toBe(true)
    expect(g.nodes.get("/a/0")!.elided).toBe(false)
    expect(nearestDrawn(g, "/a")).toBe("/")
  })

  it("ne donne aucun rect a un tableau elide, mais en donne un a ses elements", async () => {
    const g = buildGraph(data, config)
    const cs = new CollapseState(g)
    cs.expand("/products/0/tags")
    const { positions } = await createStructureLayoutEngine().layout(g, cs.visibleNodeIds())
    expect(positions.has("/products/0/tags")).toBe(false)
    expect(positions.has("/products/0/tags/0")).toBe(true)
    expect(positions.has("/products/0/tags/1")).toBe(true)
  })
})

describe("mesure d'une ligne-tableau", () => {
  it("budgete la pilule avec son chrome, pas comme du texte nu", () => {
    const g = buildGraph(data, config)
    const product = g.nodes.get("/products/0")!
    const row = product.rows.find((r) => r.key === "tags") as ArrayRow
    // La carte doit reserver plus que la seule largeur du texte : sans la marge
    // et le chevron, la pilule deborderait de la place mesuree.
    const textOnly = arrayTokenTextFor(row.value).length * DEFAULT_METRICS.valueCharWidth
    const chrome = DEFAULT_METRICS.railWidth + 2 * DEFAULT_METRICS.paddingX
    const keyW = "tags".length * DEFAULT_METRICS.keyCharWidth + DEFAULT_METRICS.gapKeyValue
    expect(measureNode(product).width).toBeGreaterThan(chrome + keyW + textOnly)
  })

  it("ne reserve ni cle ni ecart pour une ligne a valeur seule", () => {
    const g = buildGraph({ tags: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, NO_ENTITIES)
    const element = g.nodes.get("/tags/0")!
    const withKey = { ...element, rows: [{ ...element.rows[0]!, key: "k".repeat(20) }] }
    expect(measureNode(element).width).toBeLessThan(measureNode(withKey).width)
  })
})
