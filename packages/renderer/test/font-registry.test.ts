import { describe, it, expect } from "vitest";
import { createFontRegistry, fontNameFor, fontSpecFor, specKey } from "../src/font-registry.js";
import { defsquareLight, resolveTheme } from "../src/theme.js";

/** Un registre adossé à des hooks factices : on observe les installations et
 * désinstallations réelles plutôt que de se fier à des compteurs internes. */
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
  it("distingue deux themes qui ne different que par le tracking", () => {
    const a = fontSpecFor(defsquareLight, "badge");
    const b = fontSpecFor(resolveTheme({ typography: { badge: { tracking: 0.2 } } }), "badge");
    expect(specKey(a)).not.toBe(specKey(b));
  });

  it("est stable pour deux themes identiques", () => {
    const a = fontSpecFor(defsquareLight, "header");
    const b = fontSpecFor(resolveTheme(), "header");
    expect(specKey(a)).toBe(specKey(b));
  });
});

describe("FontRegistry", () => {
  it("installe un atlas par role a la premiere synchronisation", () => {
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    expect(installs).toHaveLength(4);
    expect(new Set(installs).size).toBe(4); // quatre noms distincts
  });

  it("ne reinstalle rien quand on resynchronise le meme theme", () => {
    const { registry, installs } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.sync(defsquareLight);
    lease.sync(defsquareLight);
    expect(installs).toHaveLength(4);
  });

  it("deux instances partagent les atlas d'un meme theme sans reinstaller", () => {
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    registry.lease().sync(defsquareLight);
    expect(installs).toHaveLength(4);
  });

  it("deux instances aux typographies differentes coexistent au lieu de se pietiner", () => {
    // C'etait le bug : un nom d'atlas fixe par role faisait que la seconde
    // instance ecrasait les atlas de la premiere a chaque rebuild.
    const { registry, installs, uninstalls } = harness();
    const other = resolveTheme({ typography: { header: { size: 20 } } });
    registry.lease().sync(defsquareLight);
    registry.lease().sync(other);
    expect(uninstalls).toHaveLength(0);
    expect(installs).toHaveLength(5); // 4 + le seul role qui differe
  });

  it("ne desinstalle un atlas que quand son dernier porteur le libere", () => {
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

  it("libere l'ancien atlas quand un bail change de theme", () => {
    const { registry, installs, uninstalls } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.sync(resolveTheme({ typography: { key: { size: 18 } } }));
    expect(installs).toHaveLength(5);
    expect(uninstalls).toHaveLength(1); // l'ancien atlas `key`, plus porte par personne
  });

  it("dispose() est idempotent", () => {
    const { registry, uninstalls } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.dispose();
    lease.dispose();
    expect(uninstalls).toHaveLength(4);
  });

  it("sync() apres dispose() reinstalle plutot que de laisser un bail mort", () => {
    const { registry, installs } = harness();
    const lease = registry.lease();
    lease.sync(defsquareLight);
    lease.dispose();
    lease.sync(defsquareLight);
    expect(installs).toHaveLength(8);
  });

  it("installe exactement les noms que fontNameFor derive du theme", () => {
    // C'est l'invariant qui permet a drawNode de retrouver l'atlas sans rien
    // recevoir du bail : le nom est une fonction pure du theme et du role.
    const { registry, installs } = harness();
    registry.lease().sync(defsquareLight);
    const expected = (["header", "badge", "key", "value"] as const).map((role) =>
      fontNameFor(defsquareLight, role),
    );
    expect(installs.sort()).toEqual(expected.sort());
  });
});

describe("fontNameFor", () => {
  it("est deterministe pour un meme theme", () => {
    expect(fontNameFor(defsquareLight, "header")).toBe(fontNameFor(resolveTheme(), "header"));
  });

  it("differe quand la typographie differe", () => {
    const other = resolveTheme({ typography: { header: { size: 20 } } });
    expect(fontNameFor(defsquareLight, "header")).not.toBe(fontNameFor(other, "header"));
  });

  it("differe entre deux roles d'un meme theme", () => {
    expect(fontNameFor(defsquareLight, "header")).not.toBe(fontNameFor(defsquareLight, "key"));
  });
});
