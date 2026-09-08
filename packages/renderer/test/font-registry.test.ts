import { describe, it, expect } from "vitest";
import { createFontRegistry, fontNameFor, fontSpecFor, specKey } from "../src/font-registry.js";
import { defsquareLight, resolveTheme } from "../src/theme.js";

/** A registry backed by fake hooks: we observe the actual installs and
 * uninstalls rather than trusting internal counters. */
function harness() {
  const installs: string[] = [];
  const uninstalls: string[] = [];
  const registry = createFontRegistry({
    install: (name) => installs.push(name),
    uninstall: (name) => uninstalls.push(name),
  });
  return { registry, installs, uninstalls };
}

describe("specKey", () => {
  it("distinguishes two themes that differ only by their tracking", () => {
    const a = fontSpecFor(defsquareLight, "badge");
    const b = fontSpecFor(resolveTheme({ typography: { badge: { tracking: 0.2 } } }), "badge");
    expect(specKey(a)).not.toBe(specKey(b));
  });

  it("is stable for two identical themes", () => {
    const a = fontSpecFor(defsquareLight, "header");
    const b = fontSpecFor(resolveTheme(), "header");
    expect(specKey(a)).toBe(specKey(b));
  });
});

describe("FontRegistry", () => {
  it("installs one atlas per role on the first sync", () => {
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    expect(installs).toHaveLength(4);
    expect(new Set(installs).size).toBe(4); // four distinct names
  });

  it("reinstalls nothing when the same theme is synced again", () => {
    const { registry, installs } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.sync(defsquareLight);
    lease.sync(defsquareLight);
    expect(installs).toHaveLength(4);
  });

  it("two instances share the atlases of one theme without reinstalling", () => {
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    registry.lease().sync(defsquareLight);
    expect(installs).toHaveLength(4);
  });

  it("two instances with different typography coexist instead of trampling each other", () => {
    // This was the bug: one fixed atlas name per role meant the second instance
    // overwrote the first one's atlases on every rebuild.
    const { registry, installs, uninstalls } = harness();
    const other = resolveTheme({ typography: { header: { size: 20 } } });
    registry.lease().sync(defsquareLight);
    registry.lease().sync(other);
    expect(uninstalls).toHaveLength(0);
    expect(installs).toHaveLength(5); // 4 + the one role that differs
  });

  it("uninstalls an atlas only when its last holder releases it", () => {
    const { registry, uninstalls } = harness();
    const a = registry.lease();
    const b = registry.lease();
    a.sync(defsquareLight);
    b.sync(defsquareLight);
    a.dispose();
    expect(uninstalls).toHaveLength(0);
    b.dispose();
    expect(uninstalls).toHaveLength(4);
  });

  it("releases the old atlas when a lease changes theme", () => {
    const { registry, installs, uninstalls } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.sync(resolveTheme({ typography: { key: { size: 18 } } }));
    expect(installs).toHaveLength(5);
    expect(uninstalls).toHaveLength(1); // the old `key` atlas, no longer held by anyone
  });

  it("dispose() is idempotent", () => {
    const { registry, uninstalls } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.dispose();
    lease.dispose();
    expect(uninstalls).toHaveLength(4);
  });

  it("sync() after dispose() reinstalls rather than leaving a dead lease", () => {
    const { registry, installs } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.dispose();
    lease.sync(defsquareLight);
    expect(installs).toHaveLength(8);
  });

  it("installs exactly the names fontNameFor derives from the theme", () => {
    // This is the invariant that lets drawNode find the atlas without receiving
    // anything from the lease: the name is a pure function of theme and role.
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    const expected = (["header", "badge", "key", "value"] as const).map((role) =>
      fontNameFor(defsquareLight, role),
    );
    expect(installs.sort()).toEqual(expected.sort());
  });
});

describe("fontNameFor", () => {
  it("is deterministic for a given theme", () => {
    expect(fontNameFor(defsquareLight, "header")).toBe(fontNameFor(resolveTheme(), "header"));
  });

  it("differs when the typography differs", () => {
    const other = resolveTheme({ typography: { header: { size: 20 } } });
    expect(fontNameFor(defsquareLight, "header")).not.toBe(fontNameFor(other, "header"));
  });

  it("differs between two roles of the same theme", () => {
    expect(fontNameFor(defsquareLight, "header")).not.toBe(fontNameFor(defsquareLight, "key"));
  });
});
