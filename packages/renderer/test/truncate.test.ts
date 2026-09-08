import { describe, it, expect } from "vitest";
import { buildGraph, measureNode, DEFAULT_METRICS, badgeTextFor, headerTextFor } from "@defsquare/data-graph-core";
import { truncateToWidth, charWidthFor } from "../src/draw.js";

const data = {
  customers: [
    { id: "c1", name: "Dupont", email: "dupont@example.com" },
    { id: "c2", name: "Nom-Tres-Long-Qui-Deborde", email: "adresse.electronique.tres.longue@exemple-de-domaine.fr" },
  ],
};
const config = { ids: { Customer: "$.customers[*].id" } };

describe("accord mesure / troncature", () => {
  it("aucune ligne tronquee ne depasse la largeur calculee par measureNode", () => {
    const graph = buildGraph(data, config);
    const m = DEFAULT_METRICS;

    for (const node of graph.nodes.values()) {
      const width = measureNode(node, m).width;
      const inner = width - m.railWidth - 2 * m.paddingX;

      for (const row of node.rows) {
        const keyW = row.key.length * charWidthFor("key", m);
        const budget = inner - keyW - m.gapKeyValue;
        const shown = truncateToWidth(String(row.value), budget, charWidthFor("value", m));
        const shownW = shown.length * charWidthFor("value", m);
        expect(keyW + m.gapKeyValue + shownW, `${node.id} ${row.key}`).toBeLessThanOrEqual(inner + 0.001);
      }

      const badge = badgeTextFor(node);
      const badgeW = badge.length > 0 ? m.gapKeyValue + badge.length * charWidthFor("badge", m) : 0;
      const chevronW = node.childIds.length > 0 ? m.chevronWidth : 0;
      const headerBudget = inner - badgeW - chevronW;
      const header = truncateToWidth(headerTextFor(node), headerBudget, charWidthFor("header", m));
      expect(header.length * charWidthFor("header", m)).toBeLessThanOrEqual(headerBudget + 0.001);
    }
  });

  it("tronque avec une ellipse et ne renvoie jamais plus long que l'entree", () => {
    expect(truncateToWidth("abcdefghij", 30, 6)).toBe("abcd…");
    expect(truncateToWidth("abc", 300, 6)).toBe("abc");
    expect(truncateToWidth("abc", 0, 6)).toBe("");
    expect(truncateToWidth("abc", 6, 6)).toBe("…");
  });

  // Regression, finding A (final review): a key of roughly 49+ characters at
  // `maxWidth` 340 ate up all of `inner`, made `valueBudget` negative, and
  // `truncateToWidth` returned "" for the value — which then silently vanished
  // from the card. This test reproduces `drawNode`'s computation exactly
  // (draw.ts, the row loop): the key is first truncated to a budget capped at
  // `inner - gapKeyValue - <width of one value character>`, before
  // `valueBudget` is derived from the width of the TRUNCATED key.
  it("une cle tres longue (~60 caracteres) ne fait pas disparaitre la valeur", () => {
    const m = DEFAULT_METRICS;
    const inner = m.maxWidth - m.railWidth - 2 * m.paddingX;

    const longKey = "a".repeat(60);
    const value = "42";

    const valueCharWidth = charWidthFor("value", m);
    const keyCharWidth = charWidthFor("key", m);
    const keyBudget = Math.max(0, inner - m.gapKeyValue - valueCharWidth);
    const keyStr = truncateToWidth(longKey, keyBudget, keyCharWidth);
    const keyWidth = keyStr.length * keyCharWidth;
    const valueBudget = inner - keyWidth - m.gapKeyValue;
    const valueStr = truncateToWidth(value, valueBudget, valueCharWidth);

    expect(valueStr.length).toBeGreaterThan(0);
  });
});
