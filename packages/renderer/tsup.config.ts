import { defineConfig } from "tsup";

/**
 * DEUX ENTRÉES, et deux régimes d'empaquetage OPPOSÉS — c'est tout l'intérêt de
 * ce fichier, qui remplace la ligne `tsup src/index.ts` du `package.json`.
 *
 * 1. `src/index.ts` — le paquet. Régime NORMAL : `pixi.js` et
 *    `@defsquare/data-graph-core` restent externes, c'est l'empaqueteur du
 *    consommateur qui les résout et les déduplique. Types émis.
 *
 * 2. `src/graph-layout-worker.ts` — le Web Worker de la vue graphe. Régime
 *    AUTONOME : le cœur pur du layout est bundlé DEDANS (`noExternal`). Ce n'est
 *    pas une préférence, c'est la seule forme qui marche — ce fichier est chargé
 *    par URL, pas par `import`, donc personne n'est là pour résoudre un
 *    specifier nu comme `@defsquare/data-graph-core/graph-layout` : le
 *    navigateur le lirait tel quel et échouerait. Pas de `.d.ts` non plus : on
 *    ne l'importe jamais, on le désigne.
 *
 * Ce que le worker tire réellement, et pourquoi c'est peu : le point d'entrée
 * `./graph-layout` du cœur ne dépend ni d'elkjs ni de Pixi (voir son en-tête),
 * et le worker n'en importe qu'une fonction pure. Son `import type` du protocole
 * (`./graph-view.js`) est effacé à la compilation, donc rien du renderer n'entre
 * par là — `test/bundle-purity.test.ts` en fait un invariant vérifié.
 *
 * `clean: false` DES DEUX CÔTÉS, et le nettoyage est fait par le script
 * `build` du `package.json` avant d'appeler tsup. Ce n'est pas de la
 * superstition : tsup exécute les configurations d'un tableau EN PARALLÈLE, les
 * deux écrivent dans le même `dist/`, et un `clean` porté par l'une effacerait
 * la sortie de l'autre selon qui gagne la course. Le nettoyage doit donc avoir
 * lieu une fois, avant les deux.
 */
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
  },
  {
    entry: ["src/graph-layout-worker.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    noExternal: ["@defsquare/data-graph-core"],
  },
]);
