import { describe, it, expect } from "vitest";
import * as index from "../src/index.js";

/**
 * CE TEST EST LE CONTRAT du point d'entrée public du renderer (`.`, cf. le
 * champ `exports` de `package.json`). La liste ci-dessous n'est pas une
 * observation à rafraîchir quand elle rougit : elle dit ce que le paquet
 * promet. Toute modification doit donc être VOLONTAIRE — ajouter une ligne,
 * c'est s'engager à maintenir le symbole ; en retirer une, c'est assumer une
 * rupture pour les consommateurs.
 *
 * Il vaut ici plus encore que côté cœur : le dessin bas niveau (`draw.ts`), la
 * `Camera`, l'`Emitter` et la mesure de police restent exportés de LEURS
 * modules pour les tests de ce dossier, et rien n'empêche de les remonter
 * machinalement dans le barrel en croyant « exporter proprement ». Ce test le
 * refuse.
 *
 * Seuls les exports d'EXÉCUTION sont vérifiables ainsi : les types
 * disparaissent à la compilation et n'apparaissent pas dans `Object.keys`.
 *
 * L'import passe par le CHEMIN SOURCE du point d'entrée et non par le nom du
 * paquet, pour rester dans le régime vitest du dossier ; c'est bien le même
 * fichier que `package.json` publie.
 */
describe("api surface", () => {
  it("le point d'entrée `.` exporte exactement ces symboles d'exécution", () => {
    expect(Object.keys(index).sort()).toEqual([
      "arrayTokenTextFor",
      "createDataGraph",
      "defsquareDark",
      "defsquareLight",
      "entityAccentMap",
      "neutralDark",
      "neutralLight",
      "resolveTheme",
    ]);
  });
});
