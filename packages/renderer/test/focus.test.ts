import { describe, it, expect } from "vitest";
import type { NodeId, RefEdge } from "@defsquare/data-graph-core";
import { clusterDimmed, clusterRelatedIds, DIM_ALPHA, relatedIds } from "../src/focus.js";

/** Une arête de référence nue : `relatedIds` ne lit que `fromEntity`, `to` et
 * `dangling`, et fabriquer l'objet à la main garde ces tests indépendants du
 * pipeline de construction du graphe.
 *
 * `fromEntity` vaut `from` par défaut, ce qui est l'invariant de toute
 * référence déclarée sans navigation : ces cas décrivent donc le comportement
 * inchangé, et le hissage se teste à part, en le dissociant explicitement. */
function ref(
  from: NodeId,
  to: NodeId | null,
  dangling = to === null,
  fromEntity: NodeId = from,
): RefEdge {
  return {
    kind: "ref",
    from,
    fromEntity,
    to,
    field: "someId",
    targetType: "T",
    targetId: "x",
    dangling,
  };
}

describe("relatedIds", () => {
  it("returns null when nothing is focused", () => {
    // `null` et non l'ensemble vide : les deux se lisent autrement à
    // l'application. Un ensemble vide dirait « personne n'est lié », donc
    // « estompe tout » ; `null` dit « aucun focus », donc « n'estompe rien ».
    expect(relatedIds([ref("a", "b")], null, "p", ["c"])).toBeNull();
  });

  it("always holds the focused node itself", () => {
    expect(relatedIds([], "a", null, [])).toEqual(new Set(["a"]));
  });

  it("holds the targets of the outgoing references", () => {
    const edges = [ref("a", "b"), ref("a", "c")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b", "c"]));
  });

  it("holds the sources of the incoming references", () => {
    // Une référence est ORIENTÉE, mais le lien qu'elle établit ne l'est pas :
    // une carte qui pointe vers la sélection lui est aussi liée que celle
    // qu'elle pointe.
    const edges = [ref("x", "a"), ref("y", "a")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "x", "y"]));
  });

  it("holds the parent and the direct children", () => {
    expect(relatedIds([], "a", "p", ["c1", "c2"])).toEqual(new Set(["a", "p", "c1", "c2"]));
  });

  it("ignores a dangling reference of the focused node", () => {
    // `to === null` n'est pas un voisin : il n'y a personne au bout. Sans
    // cette garde, `null` entrerait dans l'ensemble et n'y correspondrait à
    // aucune carte — inoffensif mais faux.
    const keep = relatedIds([ref("a", null)], "a", null, []);
    expect(keep).toEqual(new Set(["a"]));
    expect(keep?.has(null as unknown as NodeId)).toBe(false);
  });

  it("leaves unrelated nodes out", () => {
    const edges = [ref("a", "b"), ref("x", "y")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b"]));
  });

  it("does not pull in a grandchild, only the direct children", () => {
    // Le voisinage est à DISTANCE 1 : au-delà, l'estompage ne distinguerait
    // plus rien, ce qui est tout ce qu'on lui demande.
    expect(relatedIds([], "a", null, ["c"])).toEqual(new Set(["a", "c"]));
  });

  it("lit le bout source d'une référence sur son ENTITÉ, pas sur le value object", () => {
    // La référence est portée par `a/lines/0`, mais elle est déclarée par `a` :
    // en vue graphe, `a/lines/0` n'a aucune carte, et sélectionner `a` doit
    // garder pleine la carte que sa propre ligne référence.
    const edges = [ref("a/lines/0", "b", false, "a")];
    expect(relatedIds(edges, "a", null, [])).toEqual(new Set(["a", "b"]));
    // Et symétriquement depuis la cible : c'est `a` qui est liée, pas la ligne.
    expect(relatedIds(edges, "b", null, [])).toEqual(new Set(["b", "a"]));
  });
});

describe("clusterRelatedIds", () => {
  it("holds every member, even one with no reference at all", () => {
    // L'agrégat est l'unité désignée : un membre isolé en fait partie autant
    // que sa racine, et l'estomper contredirait l'enveloppe qui l'entoure.
    expect(clusterRelatedIds([], new Set(["m1", "m2"]))).toEqual(new Set(["m1", "m2"]));
  });

  it("holds an outside node targeted BY a member", () => {
    const keep = clusterRelatedIds([ref("m1", "out")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("holds an outside node that points AT a member", () => {
    // Même symétrie que pour une carte : une référence est orientée, le lien
    // qu'elle établit ne l'est pas.
    const keep = clusterRelatedIds([ref("out", "m1")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("ignores a dangling reference leaving a member", () => {
    // `to === null` ne désigne personne : rien à garder plein au bout.
    const keep = clusterRelatedIds([ref("m1", null)], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1"]));
    expect(keep.has(null as unknown as NodeId)).toBe(false);
  });

  it("leaves out a node linked to nothing in the aggregate", () => {
    const edges = [ref("m1", "out"), ref("x", "y")];
    expect(clusterRelatedIds(edges, new Set(["m1"]))).toEqual(new Set(["m1", "out"]));
  });

  it("does not follow a second hop out of the aggregate", () => {
    // Distance 1 depuis le BLOC, pas depuis chaque voisin : sans cette borne,
    // l'ensemble finirait par couvrir la plus grande partie du graphe.
    const edges = [ref("m1", "out"), ref("out", "far")];
    expect(clusterRelatedIds(edges, new Set(["m1"]))).toEqual(new Set(["m1", "out"]));
  });

  it("compte une référence hissée pour son entité membre", () => {
    // Le membre de l'agrégat est `m1` ; la ligne `m1/lines/0` n'en est pas un
    // et ne pourrait jamais l'être — l'appartenance ne connaît que des entités.
    const keep = clusterRelatedIds([ref("m1/lines/0", "out", false, "m1")], new Set(["m1"]));
    expect(keep).toEqual(new Set(["m1", "out"]));
  });

  it("does not mutate the member set it is given", () => {
    // L'ensemble reçu est celui de l'index d'agrégats (`Aggregate.memberIds`),
    // qui est partagé par tous ses lecteurs : y ajouter les voisins ferait
    // grossir l'agrégat à chaque sélection.
    const members = new Set(["m1"]);
    clusterRelatedIds([ref("m1", "out")], members);
    expect(members).toEqual(new Set(["m1"]));
  });

  it("returns the empty set for an aggregate with no members", () => {
    // Pas de `null` en retour, à la différence de `relatedIds` : l'absence de
    // sélection est portée par l'appelant, qui n'appelle alors pas du tout. Un
    // ensemble vide dit donc « estompe tout », ce qui est correct.
    expect(clusterRelatedIds([ref("a", "b")], new Set())).toEqual(new Set());
  });
});

describe("clusterDimmed", () => {
  it("n'estompe rien sans sélection", () => {
    // Même lecture de `null` que partout ailleurs : « aucun focus », donc
    // « n'estompe rien » — et surtout pas « personne n'est lié ».
    expect(clusterDimmed(null, ["m1", "m2"])).toBe(false);
  });

  it("garde pleine une enveloppe dont un membre est lié à la sélection", () => {
    // Un SEUL membre lié suffit : l'enveloppe est alors la seule chose qui
    // montre où ce membre habite.
    expect(clusterDimmed(new Set(["m2"]), ["m1", "m2", "m3"])).toBe(false);
  });

  it("estompe une enveloppe dont aucun membre n'est lié", () => {
    expect(clusterDimmed(new Set(["x", "y"]), ["m1", "m2"])).toBe(true);
  });

  it("garde pleine l'enveloppe SÉLECTIONNÉE sans cas particulier", () => {
    // `clusterRelatedIds` part des membres : ils sont donc tous dans l'ensemble
    // à garder, et la règle générale suffit à ne pas estomper l'agrégat désigné.
    const members = new Set(["m1", "m2"]);
    const keep = clusterRelatedIds([ref("m1", "out")], members);
    expect(clusterDimmed(keep, members)).toBe(false);
  });

  it("estompe une enveloppe sans aucun membre quand une sélection est active", () => {
    // Rien à garder plein là-dedans : l'ensemble vide ne rencontre jamais
    // l'ensemble à garder. Le cas ne devrait pas exister (un agrégat a au moins
    // sa racine), mais il ne doit pas se lire comme « pas de sélection ».
    expect(clusterDimmed(new Set(["a"]), [])).toBe(true);
    expect(clusterDimmed(null, [])).toBe(false);
  });

  it("accepte un Set de membres aussi bien qu'un tableau", () => {
    // L'appelant réel passe `Aggregate.memberIds`, qui est un Set ; les tests
    // ci-dessus passent des tableaux. Les deux doivent décider pareil.
    expect(clusterDimmed(new Set(["m1"]), new Set(["m1"]))).toBe(false);
    expect(clusterDimmed(new Set(["m1"]), new Set(["m2"]))).toBe(true);
  });
});

describe("DIM_ALPHA", () => {
  it("is a legible-but-clearly-receding opacity", () => {
    expect(DIM_ALPHA).toBeGreaterThan(0);
    expect(DIM_ALPHA).toBeLessThan(1);
  });
});
