import { describe, it, expect } from "vitest"
import * as index from "../src/index.js"
import * as graphLayout from "../src/graph-layout.js"

/**
 * CE TEST EST LE CONTRAT des deux points d'entrée publics du cœur (`.` et
 * `./graph-layout`, cf. le champ `exports` de `package.json`). Les listes
 * ci-dessous ne sont pas une observation à rafraîchir quand elles rougissent :
 * elles disent ce que le paquet promet. Toute modification doit donc être
 * VOLONTAIRE — ajouter une ligne, c'est s'engager à maintenir le symbole ; en
 * retirer une, c'est assumer une rupture pour les consommateurs.
 *
 * Seuls les exports d'EXÉCUTION sont vérifiables ainsi : les types disparaissent
 * à la compilation et n'apparaissent pas dans `Object.keys`. C'est sans perte
 * pour ce que ce test garde — une surface d'exécution qui grossit par accident
 * (un symbole interne remonté « au cas où ») est précisément ce qu'on veut voir.
 *
 * L'import passe par le CHEMIN SOURCE du point d'entrée et non par le nom du
 * paquet, pour rester dans le régime vitest du dossier (pas de `dist/` à jour
 * requis) ; c'est bien le même fichier que `package.json` publie.
 */
describe("api surface", () => {
  it("le point d'entrée `.` exporte exactement ces symboles d'exécution", () => {
    expect(Object.keys(index).sort()).toEqual([
      "CollapseState",
      "ConfigError",
      "DEFAULT_METRICS",
      "GraphTooLargeError",
      "VERSION",
      "anchorRectFor",
      "arrayTokenTextFor",
      "arrayTokenWidth",
      "badgeTextFor",
      "buildAggregates",
      "buildGraph",
      "buildSearchIndex",
      "createStructureLayoutEngine",
      "enclosingCircle",
      "headerTextFor",
      "isValueOnlyRow",
      "measureNode",
      "nearestCardRectFor",
      "rowRectFor",
      "validateConfig",
    ])
  })

  it("le point d'entrée `./graph-layout` exporte exactement ces symboles d'exécution", () => {
    expect(Object.keys(graphLayout).sort()).toEqual([
      "TWO_LEVEL_LAYOUT_DEFAULTS",
      "createTwoLevelLayoutEngine",
    ])
  })
})
