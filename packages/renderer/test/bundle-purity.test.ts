import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Pendant renderer du test de pureté de `packages/core` — et la moitié
 * manquante de la chaîne. Celui du cœur vérifie que le `dist/index.js` du CŒUR
 * n'atteint pas le moteur de la vue graphe ; mais le chargement paresseux de
 * cette vue ne tient PAS là : il tient à deux lignes de `src/graph-view.ts`,
 * l'`import type` du point d'entrée `./graph-layout` et l'`import()` dynamique
 * d'`ensureEngine`. Transformer cet `import type` en import de valeur
 * suffit à faire entrer tout ce que ce point d'entrée tire dans le bundle de
 * TOUT consommateur — et, avant ce test, la totalité de la suite (cœur,
 * renderer, e2e), le build et le typecheck restaient verts.
 *
 * L'ENJEU A CHANGÉ D'ORDRE DE GRANDEUR, et le dire fait partie du test. Ces
 * deux lignes gardaient ~178 ko gzip tant que l'ancien moteur importait
 * `cytoscape` + `cytoscape-fcose` ; ce moteur est retiré et le chunk mesure
 * désormais **2,64 ko gzip** au lieu de 180,28. Une régression coûterait donc
 * 2,64 ko, pas 178. Ce que ces deux lignes gardent encore, et qui n'a pas de
 * substitut, c'est la FORME : la vue graphe est chargée à la demande par
 * construction, `setView` est asynchrone pour cette raison, et tout poids qu'on
 * ajoutera derrière cette vue héritera de la paresse au lieu d'avoir à la
 * redemander. Voir la même mise au point dans
 * `packages/core/test/bundle-purity.test.ts`.
 *
 * Ces deux lignes VIVAIENT dans `src/create.ts` ; elles ont suivi l'état de la
 * vue graphe dans `src/graph-view.ts` (étape M2a de
 * `docs/superpowers/specs/2026-09-06-view-machine-design.md`), et ce test avec
 * elles. Rien de la règle n'a changé : la première assertion balaie TOUTES les
 * sources du renderer et ne connaît aucun nom de fichier, donc l'interdiction
 * d'un import de valeur reste posée partout — `create.ts` compris, qui garde un
 * `import type` du même point d'entrée pour relayer `TwoLevelLayoutOptions` à
 * l'API publique. Seule la contre-garde, qui doit bien nommer le fichier où
 * l'`import()` dynamique se trouve, a changé de cible.
 *
 * Le test est volontairement un examen du SOURCE par expression régulière, et
 * pas une inspection du bundle : ce qu'il faut interdire est une propriété
 * syntaxique (« aucun import statique de valeur vers ce specifier »), que le
 * `dist/` du renderer ne révèle pas — tsup efface l'`import type` comme il
 * conserverait un import de valeur, et seul le bundler du consommateur, en
 * aval, verrait la différence. Lire le source est ici la manière honnête de
 * tester la chose : c'est exactement l'invariant qu'on demanderait à un
 * relecteur de tenir à la main.
 */

/** Retire commentaires de bloc et de ligne. Indispensable : le commentaire qui
 * documente justement cette règle au-dessus de l'import contient les mots
 * « `import type` », et une première version de ce test s'y accrochait — elle
 * lisait le commentaire, y voyait un `import type` conforme, et laissait donc
 * passer l'import de VALEUR situé juste en dessous. La garde `[^:]` évite de
 * tronquer un `https://` pris pour un commentaire. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

describe("bundle purity (renderer sources)", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const SPECIFIER = "@defsquare/data-graph-core/graph-layout";
  const SPEC_RE = SPECIFIER.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: stripComments(readFileSync(join(srcDir, name), "utf8")) }));

  it("has sources to scan", () => {
    // Garde anti-test-creux : si le dossier était vide ou mal résolu, toutes
    // les assertions ci-dessous passeraient sans rien vérifier.
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.map((s) => s.name)).toContain("create.ts");
    // Le porteur du chargement paresseux : un renommage ou une suppression doit
    // faire échouer ce test-ci, pas rendre la contre-garde ci-dessous vacante.
    expect(sources.map((s) => s.name)).toContain("graph-view.ts");
  });

  it("never statically imports the graph-layout entry point as a value", () => {
    for (const { name, code } of sources) {
      // `import <clause> from "<specifier>"` — la clause doit commencer par
      // `type`. Ancrée en début de ligne (`^[ \t]*`, drapeau `m`) : une
      // déclaration d'import l'est toujours. La clause peut courir sur
      // plusieurs lignes (imports nommés) mais ne doit pas traverser un autre
      // `from`, sinon la capture partirait d'un import antérieur du fichier et
      // avalerait tout ce qui le sépare de celui-ci.
      const withClause = new RegExp(
        `^[ \\t]*import\\s+((?:(?!\\bfrom\\b)[\\s\\S])*?)from\\s+["']${SPEC_RE}["']`,
        "gm",
      );
      for (const match of code.matchAll(withClause)) {
        expect(
          match[1]!.trimStart().startsWith("type"),
          `${name}: import de VALEUR vers ${SPECIFIER} — la vue graphe entrerait dans le bundle de tout consommateur`,
        ).toBe(true);
      }

      // Import nu (`import "<specifier>"`) et réexport (`export … from`) : deux
      // formes qui n'admettent aucune clause `type`, donc interdites d'office.
      expect(code, `${name}: import nu de ${SPECIFIER}`).not.toMatch(
        new RegExp(`^[ \\t]*import\\s+["']${SPEC_RE}["']`, "m"),
      );
      expect(code, `${name}: réexport de ${SPECIFIER}`).not.toMatch(
        new RegExp(`^[ \\t]*export\\s+(?:(?!\\bfrom\\b)[\\s\\S])*?from\\s+["']${SPEC_RE}["']`, "m"),
      );
    }
  });

  it("still reaches the engine through a dynamic import", () => {
    // Contre-garde de l'assertion précédente : sans elle, supprimer purement et
    // simplement les deux imports la ferait passer tout en cassant la vue
    // graphe. Le SEUL chemin d'exécution vers le moteur doit rester cet
    // `import()` dynamique, et les types doivent venir d'un `import type`.
    const graphView = sources.find((s) => s.name === "graph-view.ts")!.code;
    expect(graphView).toMatch(new RegExp(`import\\(\\s*["']${SPEC_RE}["']`));
    expect(graphView).toMatch(
      new RegExp(
        `^[ \\t]*import\\s+type\\s+(?:(?!\\bfrom\\b)[\\s\\S])*?from\\s+["']${SPEC_RE}["']`,
        "m",
      ),
    );

    // Et NULLE PART ailleurs : un second `import()` du même point d'entrée
    // signifierait un second chemin de chargement, que rien ne tiendrait
    // d'accord avec celui-ci — c'est justement ce que `graph-view.ts` possède en
    // propre depuis M2a. `create.ts` en particulier n'en garde plus aucun.
    const dynamicImporters = sources
      .filter(({ code }) => new RegExp(`import\\(\\s*["']${SPEC_RE}["']`).test(code))
      .map((s) => s.name);
    expect(dynamicImporters).toEqual(["graph-view.ts"]);
  });
});
