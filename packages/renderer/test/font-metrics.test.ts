import { describe, it, expect } from "vitest";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import { measureFontMetrics } from "../src/font-metrics.js";
import { defsquareLight } from "../src/theme.js";

describe("measureFontMetrics", () => {
  it("retombe sur les metriques de base quand aucun contexte 2D n'existe", () => {
    expect(measureFontMetrics(defsquareLight, DEFAULT_METRICS)).toEqual(DEFAULT_METRICS);
  });
});
