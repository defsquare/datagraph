import { describe, it, expect } from "vitest";
import { buildGraph } from "@defsquare/data-graph-core";
import { nearestEntityAncestor } from "../src/create.js";
import { shopData, shopConfig } from "./fixtures.js";

describe("nearestEntityAncestor", () => {
  const graph = buildGraph(shopData, shopConfig);

  it("returns the node itself when it is an entity", () => {
    expect(nearestEntityAncestor(graph, "/customers/0")).toBe("/customers/0");
  });

  it("walks up to the closest entity ancestor", () => {
    // /customers/0/address est un objet imbriqué sous une entité.
    expect(nearestEntityAncestor(graph, "/customers/0/address")).toBe("/customers/0");
  });

  it("returns null when no ancestor is an entity", () => {
    expect(nearestEntityAncestor(graph, "/customers")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nearestEntityAncestor(graph, "/nope")).toBeNull();
  });
});
