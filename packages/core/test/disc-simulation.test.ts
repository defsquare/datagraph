import { describe, it, expect } from "vitest"
import { layoutDiscs, type Disc } from "../src/disc-simulation.js"

// Le niveau 2 testé SEUL, sans passer par le moteur : `graph-layout.test.ts`
// l'exerce à travers des fixtures de graphe, ce qui plafonne à quelques
// centaines de disques et mélange le coût du packing à celui de la simulation.
// Ici on fabrique directement le tableau de disques, donc on choisit le
// cardinal — et c'est le cardinal qui est le sujet.
//
// Le jeu réel qui a motivé la grille spatiale (audit d'archi BNPP, 6 251
// entités) produit ~1 300 disques ; on en prend 1 500 pour rester au-dessus.

/** Le même FNV-1a que le module, recopié ici pour que le fixture ne dépende
 * que de son propre indice — aucune source d'aléa, donc un jeu d'entrée
 * identique d'une exécution à l'autre. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const COUNT = 1500
const CLUSTER_GAP = 160

/** Rayons variés — de 40 à 200 px, l'ordre de grandeur des enveloppes
 * d'agrégats réelles — tirés du hachage de l'indice. */
function makeDiscs(): Disc[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    id: `d${i}`,
    r: 40 + (hash(`d${i}:r`) / 0xffffffff) * 160,
    x: 0,
    y: 0,
  }))
}

/** ~4 500 paires : le régime de couplage d'un vrai graphe d'archi, où les
 * ressorts ont autant de mots à dire que la collision. */
function makePairs(): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = []
  for (let i = 0; i < COUNT; i++) {
    for (let k = 0; k < 3; k++) {
      const j = hash(`edge:${i}:${k}`) % COUNT
      if (j !== i) pairs.push([`d${i}`, `d${j}`] as const)
    }
  }
  return pairs
}

const OPTIONS = { clusterGap: CLUSTER_GAP, simIterations: 300, jitter: 32 }

describe("layoutDiscs à l'échelle du jeu réel", () => {
  it(
    "tient l'invariant de séparation sur 1 500 disques, en secondes",
    () => {
      const discs = makeDiscs()
      const t0 = Date.now()
      layoutDiscs(discs, makePairs(), OPTIONS)
      const elapsed = Date.now() - t0

      // L'invariant vérifié par FORCE BRUTE sur le résultat : c'est un test,
      // le O(n²) y est le bon outil — il ne partage aucune structure avec
      // l'implémentation, donc un bug de la grille (une paire jamais énumérée)
      // tombe ici et pas ailleurs.
      let violations = 0
      let worst = 0
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + CLUSTER_GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            worst = Math.max(worst, min - d)
          }
        }
      }
      expect({ violations, worst, elapsed }).toEqual({ violations: 0, worst: 0, elapsed })

      // La borne de temps n'est pas un micro-benchmark : elle sépare deux
      // régimes. Avec la double boucle O(k²) d'origine ce volume demandait
      // plusieurs minutes (le test sortait en timeout) ; avec la grille il
      // tient largement sous la seconde ou deux.
      expect(elapsed).toBeLessThan(20_000)
    },
    30_000,
  )

  it(
    "reste déterministe au bit près à cette échelle",
    () => {
      // La grille ne doit rien emprunter à l'ordre d'itération d'une Map ou
      // d'un Set : son parcours est dérivé des seuls indices du tableau et des
      // positions. Deux exécutions sur des copies de la même entrée doivent
      // donc rendre exactement les mêmes flottants.
      const a = makeDiscs()
      const b = makeDiscs()
      layoutDiscs(a, makePairs(), OPTIONS)
      layoutDiscs(b, makePairs(), OPTIONS)
      expect(a.map((c) => [c.x, c.y])).toEqual(b.map((c) => [c.x, c.y]))
    },
    30_000,
  )
})

describe("convergence en chaîne", () => {
  it(
    "sépare une chaîne de 200 disques dont chaque séparation en déclenche une autre",
    () => {
      // Le pire cas de `hardSeparation` n'est pas la densité mais la
      // PROPAGATION : une chaîne où écarter i de i+1 rentre dans i+2, dont la
      // séparation rentre dans i+3, etc. Chaque passe ne règle qu'un bout de la
      // chaîne, il en faut beaucoup, et c'est le budget de convergence — pas
      // l'énumération — qui est sur la sellette.
      //
      // `layoutDiscs` ré-amorce toujours les positions, donc on ne peut pas
      // POSER une chaîne colinéaire depuis l'extérieur. On la fait produire par
      // le moteur, ce qui est de toute façon le cas réaliste : une chaîne de
      // ressorts de poids fort comprime les 200 disques sur une ligne, et la
      // passe dure doit la rouvrir maillon par maillon.
      const N = 200
      const GAP = 24
      const discs: Disc[] = Array.from({ length: N }, (_, i) => ({
        id: `chain${i}`,
        r: 30,
        x: 0,
        y: 0,
      }))
      const pairs: Array<readonly [string, string]> = []
      for (let i = 0; i + 1 < N; i++) {
        // Poids fort : le ressort domine largement, la chaîne se comprime et la
        // passe dure doit la rouvrir maillon par maillon.
        for (let k = 0; k < 4; k++) pairs.push([`chain${i}`, `chain${i + 1}`] as const)
      }

      layoutDiscs(discs, pairs, { clusterGap: GAP, simIterations: 200, jitter: 0 })

      let violations = 0
      let worst = 0
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            worst = Math.max(worst, min - d)
          }
        }
      }
      expect({ violations, worst }).toEqual({ violations: 0, worst: 0 })
    },
    30_000,
  )

  it("la cascade reste déterministe au bit près", () => {
    // Une chaîne enchaîne des milliers de passes sur les mêmes tampons : c'est
    // le régime où un résidu d'état entre passes se verrait le plus vite, et il
    // se verrait dans les derniers bits.
    const build = (): Disc[] =>
      Array.from({ length: 120 }, (_, i) => ({ id: `casc${i}`, r: 25, x: 0, y: 0 }))
    const pairs: Array<readonly [string, string]> = []
    for (let i = 0; i + 1 < 120; i++) pairs.push([`casc${i}`, `casc${i + 1}`] as const)
    const a = build()
    const b = build()
    const o = { clusterGap: 30, simIterations: 150, jitter: 0 }
    layoutDiscs(a, pairs, o)
    layoutDiscs(b, pairs, o)
    expect(a.map((c) => [c.x, c.y])).toEqual(b.map((c) => [c.x, c.y]))
  })

  it("deux mises en page successives ne se marchent pas dessus par les tampons", () => {
    // Les tampons de la grille persistent au module. Un jeu GRAND suivi d'un
    // jeu PETIT relit donc des tableaux surdimensionnés dont la queue porte les
    // résidus du précédent : si une remise à zéro manquait (`starts`, l'
    // histogramme des cellules, ou `cellRMax`, le max des rayons par cellule qui
    // pilote l'élagage), le second layout produirait autre chose que s'il avait
    // tourné seul. On compare exactement ça.
    const small = (): Disc[] =>
      Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, r: 18 + (i % 5) * 7, x: 0, y: 0 }))
    const o = { clusterGap: 45, simIterations: 120, jitter: 6 }

    const alone = small()
    layoutDiscs(alone, [], o)

    const big = Array.from({ length: 900 }, (_, i) => ({ id: `b${i}`, r: 30, x: 0, y: 0 }))
    layoutDiscs(big, [], { clusterGap: 70, simIterations: 60, jitter: 12 })
    const after = small()
    layoutDiscs(after, [], o)

    expect(after.map((c) => [c.x, c.y])).toEqual(alone.map((c) => [c.x, c.y]))
  })
})

describe("entrées dégénérées", () => {
  it("zéro ou un disque ne fait rien exploser", () => {
    const none: Disc[] = []
    layoutDiscs(none, [], OPTIONS)
    expect(none).toEqual([])

    const one: Disc[] = [{ id: "solo", r: 30, x: 999, y: -999 }]
    layoutDiscs(one, [], OPTIONS)
    expect(Number.isFinite(one[0]!.x)).toBe(true)
    expect(Number.isFinite(one[0]!.y)).toBe(true)
  })

  it("des rayons nuls et un gap nul ne demandent aucune séparation", () => {
    // Cas limite de la grille : la taille de cellule dérive du diamètre max et
    // du gap, donc elle vaut 0 ici. Aucune paire ne peut violer quoi que ce
    // soit (`min` vaut 0, `d ≥ 0`), la passe doit le voir et rendre 0.
    const discs: Disc[] = Array.from({ length: 40 }, (_, i) => ({
      id: `z${i}`,
      r: 0,
      x: 0,
      y: 0,
    }))
    layoutDiscs(discs, [], { clusterGap: 0, simIterations: 20, jitter: 0 })
    for (const c of discs) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
    }
  })

  it("sépare des disques empilés exactement au même point", () => {
    // Centres confondus : la direction de poussée vient du hachage des ids. La
    // grille les met tous dans la MÊME cellule, ce qui est le pire cas de
    // densité, et l'invariant doit tenir quand même.
    const discs: Disc[] = Array.from({ length: 30 }, (_, i) => ({
      id: `stack${i}`,
      r: 20,
      x: 0,
      y: 0,
    }))
    // Après `seedDiscs` ils ne sont plus confondus ; on force le cas en
    // écrasant l'amorçage par un jitter nul et un gap qui les fait tous se
    // toucher. L'assertion porte sur la sortie.
    layoutDiscs(discs, [], { clusterGap: 50, simIterations: 50, jitter: 0 })
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!
        const b = discs[j]!
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r + 50 - 1e-6)
      }
    }
  })

  it("un disque géant parmi des petits reste séparé de tous", () => {
    // La fenêtre de recherche doit couvrir `r_i + r_max + gap` pour CHAQUE
    // disque, y compris les petits : sinon aucun petit ne verrait jamais le
    // géant et l'invariant sauterait sur ces paires-là exactement.
    const discs: Disc[] = [
      { id: "giant", r: 3000, x: 0, y: 0 },
      ...Array.from({ length: 120 }, (_, i) => ({ id: `small${i}`, r: 12, x: 0, y: 0 })),
    ]
    layoutDiscs(discs, [], { clusterGap: 40, simIterations: 100, jitter: 8 })
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!
        const b = discs[j]!
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r + 40 - 1e-6)
      }
    }
  })

  it(
    "les petits trouvent le géant alors que l'élagage par cellule coupe leur fenêtre",
    () => {
      // LE cas qui discrimine l'élagage par cellule, dimensionné pour que la
      // grille l'exerce vraiment — le test précédent ne le fait pas : avec 120
      // petits autour d'un géant, la grille ne fait que quelques cellules et
      // rien n'est jamais élagué.
      //
      // Ici : 600 petits (r = 30) plus un géant (r = 2000), gap 60. La maille
      // vaut (2·2000 + 60)/3 ≈ 1353 px et la fenêtre d'un petit fait 2 anneaux.
      // Le seuil d'élagage de l'anneau 2 est (2−1)·1353 − (30 + 60) ≈ 1263 px :
      // toute cellule qui n'abrite que des petits (max de rayon 30) est donc
      // sautée à l'anneau 2, alors que la cellule du géant (max de rayon 2000)
      // ne l'est PAS. C'est exactement la discrimination qu'on veut voir tenir —
      // un élagage qui se tromperait de max ferait rater le géant à tous les
      // petits situés à deux anneaux de lui, et l'invariant sauterait sur ces
      // paires-là et seulement sur elles.
      const GAP = 60
      const discs: Disc[] = [
        { id: "giant", r: 2000, x: 0, y: 0 },
        ...Array.from({ length: 600 }, (_, i) => ({ id: `tiny${i}`, r: 30, x: 0, y: 0 })),
      ]
      layoutDiscs(discs, [], { clusterGap: GAP, simIterations: 150, jitter: 10 })

      let violations = 0
      let worstGiant = 0
      for (let i = 0; i < discs.length; i++) {
        for (let j = i + 1; j < discs.length; j++) {
          const a = discs[i]!
          const b = discs[j]!
          const min = a.r + b.r + GAP
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < min - 1e-6) {
            violations++
            // On isole les paires QUI TOUCHENT LE GÉANT : ce sont elles que
            // l'élagage mettrait en défaut, et les distinguer rend le
            // diagnostic immédiat en cas de régression.
            if (i === 0) worstGiant = Math.max(worstGiant, min - d)
          }
        }
      }
      expect({ violations, worstGiant }).toEqual({ violations: 0, worstGiant: 0 })
    },
    30_000,
  )
})
