import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTokensCss } from "../src/css.js";

describe("renderTokensCss", () => {
  it("reproduit exactement les blocs de tokens historiques de style.css", () => {
    const css = renderTokensCss();
    // A few anchors: the full byte-for-byte check is the freshness test's job.
    expect(css).toContain("--ds-canvas: #eef0f3;");
    expect(css).toContain("--ds-fg: #070f19;");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain("--float-bg: rgb(30 35 53 / 0.82);");
    expect(css).toContain('--font-title: "EB Garamond", Garamond, Cambria, Georgia, serif;');
    expect(css).toContain("--radius-full: 9999px;");
    expect(css).toContain("--space-6: 24px;");
  });

  it("est à jour dans apps/demo (fraîcheur du fichier généré)", () => {
    // `import.meta.url` rather than `__dirname`: the package is pure ESM, and
    // this path must stay valid outside vitest's transform (Node scripts).
    const committed = readFileSync(
      fileURLToPath(new URL("../../../apps/demo/src/tokens.css", import.meta.url)),
      "utf8",
    );
    expect(committed).toBe(renderTokensCss());
  });
});
