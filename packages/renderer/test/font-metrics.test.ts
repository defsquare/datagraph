import { describe, it, expect } from "vitest";
import { DEFAULT_METRICS } from "@defsquare/data-graph-core";
import { measureFontMetrics } from "../src/font-metrics.js";
import { defsquareLight } from "../src/theme.js";

describe("measureFontMetrics", () => {
  it("falls back to the baseline metrics when no 2D context exists", () => {
    expect(measureFontMetrics(defsquareLight, DEFAULT_METRICS)).toEqual(DEFAULT_METRICS);
  });
});
