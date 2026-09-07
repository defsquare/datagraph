import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "../src/css.js";

describe("renderTokensCss", () => {
  it("reproduit exactement les blocs de tokens historiques de style.css", () => {
    const css = renderTokensCss();
    // Quelques ancrages : le byte-à-byte complet est couvert par le test de fraîcheur.
    expect(css).toContain("--ds-canvas: #eef0f3;");
    expect(css).toContain("--ds-fg: #070f19;");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--float-bg: rgb(30 35 53 / 0.82);");
    expect(css).toContain('--font-title: "EB Garamond", Garamond, Cambria, Georgia, serif;');
    expect(css).toContain("--radius-full: 9999px;");
    expect(css).toContain("--space-6: 24px;");
  });

  it("est à jour dans apps/demo (fraîcheur du fichier généré)", () => {
    // `import.meta.url` plutôt que `__dirname` : le package est en ESM pur, et
    // ce chemin doit rester valable hors transformation vitest (scripts Node).
    const committed = readFileSync(
      fileURLToPath(new URL("../../../apps/demo/src/tokens.css", import.meta.url)),
      "utf8",
    );
    expect(committed).toBe(renderTokensCss());
  });
});
