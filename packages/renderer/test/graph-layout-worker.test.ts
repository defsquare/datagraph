import { describe, it, expect, vi } from "vitest";
import { buildGraph, DEFAULT_METRICS, type DataGraphConfig, type NodeMetrics } from "@defsquare/data-graph-core";
import { layoutFromInput, type GraphLayoutInput } from "@defsquare/data-graph-core/graph-layout";
import {
  createGraphViewController,
  type GraphLayoutWorkerHandle,
  type GraphLayoutWorkerRequest,
  type GraphLayoutWorkerResponse,
  type GraphViewController,
  type GraphViewHooks,
} from "../src/graph-view.js";
import { shopConfig, shopData } from "./fixtures.js";

/**
 * LE PROTOCOLE DU WORKER DE MISE EN PAGE, testé sans navigateur.
 *
 * C'est possible — et c'est tout le bénéfice de la forme choisie — parce que le
 * contrôleur ne connaît pas `Worker` : il reçoit une FABRIQUE
 * (`GraphViewHooks.spawnLayoutWorker`), et `create.ts` est le seul endroit du
 * dépôt qui écrive `new Worker`. On injecte donc ici un faux worker qui répond
 * exactement ce qu'on lui dit de répondre, et on vérifie les quatre choses que
 * le protocole promet :
 *
 *  1. une réponse correcte est appliquée, et la mise en page qui en sort est
 *     celle du moteur — pas une approximation reconstruite de travers ;
 *  2. une réponse de génération PÉRIMÉE est jetée sans rien publier ni résoudre ;
 *  3. un échec (message d'erreur, worker injouable) avertit UNE fois et se
 *     replie sur le moteur en processus, DÉFINITIVEMENT ;
 *  4. `destroy()` termine le worker et solde ce qui est en vol.
 *
 * Le faux worker calcule pour de vrai, via `layoutFromInput` : c'est ce qui rend
 * l'assertion 1 intéressante — la sortie doit être identique à celle du chemin
 * en processus, sérialisation comprise.
 */

const graphConfig: DataGraphConfig = { ...shopConfig, groups: ["Customer"] };
const shopGraph = buildGraph(shopData, graphConfig);

/**
 * Un faux worker à la main : rien ne part tout seul.
 *
 * `requests` garde ce qui a été posté, `flush()` répond à la plus ancienne
 * requête en attente, et `reply()` permet d'écrire n'importe quelle réponse —
 * y compris une génération qui n'a jamais été demandée, ce qui est le cœur de
 * l'assertion 2.
 */
function fakeWorker() {
  const requests: GraphLayoutWorkerRequest[] = [];
  let onMessage: ((data: unknown) => void) | null = null;
  let onError: ((error: unknown) => void) | null = null;
  let terminated = 0;
  let spawns = 0;

  const spawn = (message: (data: unknown) => void, error: (err: unknown) => void): GraphLayoutWorkerHandle => {
    spawns++;
    onMessage = message;
    onError = error;
    return {
      post: (request) => void requests.push(request),
      terminate: () => void terminated++,
    };
  };

  return {
    spawn,
    requests,
    spawns: () => spawns,
    terminated: () => terminated,
    reply: (response: GraphLayoutWorkerResponse) => onMessage?.(response),
    fail: (error: unknown) => onError?.(error),
    /** Répond à la requête d'indice `i` en calculant réellement la mise en page,
     * comme le vrai worker : même aplatissement, même contenu. */
    flush: (i = 0) => {
      const request = requests[i]!;
      const { positions, clusters } = layoutFromInput(request.input);
      const flat: [string, number, number, number, number][] = [];
      for (const [id, rect] of positions) flat.push([id, rect.x, rect.y, rect.width, rect.height]);
      onMessage?.({ gen: request.gen, ok: true, positions: flat, clusters });
    },
  };
}

function controllerFor(hooks: Partial<GraphViewHooks> = {}): GraphViewController {
  return createGraphViewController({
    layoutOptions: undefined,
    getMetrics: (): NodeMetrics => DEFAULT_METRICS,
    ...hooks,
  });
}

describe("worker de mise en page — le chemin nominal", () => {
  it("extrait sur le thread principal et envoie une entrée CLONABLE", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);

    // L'extraction est synchrone une fois le module chargé ; un tour de boucle
    // suffit à la voir partir.
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    const request = worker.requests[0]!;
    expect(request.gen).toBe(1);
    // La propriété qui compte : ce qui part traverse un `postMessage`. Un
    // `Graph`, une `Map` de nœuds ou une fonction qui aurait fui s'y verrait.
    expect(structuredClone(request.input)).toEqual(request.input);
    // Et c'est bien l'entrée du moteur, pas un objet de circonstance.
    expect(request.input.entities.map((e) => e.id).sort()).toEqual(
      [...controller.entityIds(shopGraph)].sort(),
    );

    worker.flush();
    const state = await pending;
    expect(state.layout.clusters.map((c) => c.aggregateId).sort()).toEqual([
      "Customer#c1",
      "Customer#c2",
    ]);
  });

  it("rend EXACTEMENT la mise en page du moteur en processus", async () => {
    const worker = fakeWorker();
    const viaWorker = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = viaWorker.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.flush();
    const workerState = await pending;

    const inProcessState = await controllerFor().compute(shopGraph, graphConfig, false);

    // La sérialisation en tuples puis la réhydratation ne doivent rien perdre —
    // ni une carte, ni une décimale.
    expect([...workerState.layout.positions.entries()].sort()).toEqual(
      [...inProcessState.layout.positions.entries()].sort(),
    );
    expect(workerState.layout.clusters).toEqual(inProcessState.layout.clusters);
  });

  it("rend des enveloppes et des rects MUTABLES : le déplacement les mute en place", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.flush();
    controller.publish(await pending);

    // Ce que fait `translateCluster` à chaque image d'un déplacement d'agrégat.
    // Un objet figé ferait échouer ici, et NULLE PART ailleurs.
    const cluster = controller.clusters()[0]!;
    cluster.cx += 10;
    expect(controller.clusters()[0]!.cx).toBe(cluster.cx);
    const rect = controller.positions()!.get("/customers/0")!;
    rect.x += 7;
    expect(controller.positions()!.get("/customers/0")!.x).toBe(rect.x);
  });

  it("n'ouvre qu'UN worker, réutilisé d'un calcul à l'autre", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });

    const first = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.flush(0);
    await first;

    const second = controller.compute(shopGraph, graphConfig, true);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.flush(1);
    await second;

    expect(worker.spawns()).toBe(1);
    // Les générations sont monotones : deux requêtes n'en partagent jamais une.
    expect(worker.requests.map((r) => r.gen)).toEqual([1, 2]);
  });

  it("n'ouvre AUCUN worker tant qu'on ne met rien en page", () => {
    const worker = fakeWorker();
    controllerFor({ spawnLayoutWorker: worker.spawn });
    expect(worker.spawns()).toBe(0);
  });
});

describe("worker de mise en page — générations", () => {
  it("JETTE une réponse dont la génération ne correspond à aucune requête", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

    // Une réponse d'une génération périmée — typiquement celle d'un `setData`
    // dont le calcul a été soldé entre-temps. Elle ne doit ni résoudre la
    // requête en cours, ni rien publier.
    let settled = false;
    void pending.then(() => (settled = true));
    worker.reply({ gen: 999, ok: true, positions: [["/customers/0", 1, 2, 3, 4]], clusters: [] });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(controller.positions()).toBeUndefined();

    // …et la vraie réponse, elle, passe.
    worker.flush();
    await expect(pending).resolves.toBeDefined();
  });

  it("apparie chaque réponse à SA requête, même arrivées dans le désordre", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });

    const first = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    const second = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));

    // La seconde répond d'abord : sans appariement par génération, elle
    // résoudrait la première.
    worker.flush(1);
    worker.reply({ gen: worker.requests[0]!.gen, ok: false, message: "boom" });

    await expect(second).resolves.toBeDefined();
    // La première a bien reçu SON échec, et pas la réussite de l'autre. Le repli
    // en processus la sauve, mais c'est un autre test qui le dit.
    await expect(first).resolves.toBeDefined();
  });
});

describe("worker de mise en page — repli définitif", () => {
  /** Le contrôleur avertit sur `console.warn` ; on le fait taire et on le lit. */
  function withWarn<T>(run: (warn: ReturnType<typeof vi.spyOn>) => Promise<T>): Promise<T> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return run(warn).finally(() => warn.mockRestore());
  }

  it("se replie en processus quand le worker répond une erreur, et n'avertit qu'une fois", async () => {
    const worker = fakeWorker();
    await withWarn(async (warn) => {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });

      const first = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
      worker.reply({ gen: worker.requests[0]!.gen, ok: false, message: "layout exploded" });

      // La mise en page arrive quand même : c'est le moteur en processus.
      const state = await first;
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("graphLayoutWorkerUrl");
      // Le worker est terminé, pas laissé à tourner.
      expect(worker.terminated()).toBe(1);

      // DÉFINITIF : le calcul suivant ne repasse pas par le worker, et
      // n'avertit pas une seconde fois.
      const second = await controller.compute(shopGraph, graphConfig, true);
      expect(second.layout.clusters).toHaveLength(2);
      expect(worker.requests).toHaveLength(1);
      expect(worker.spawns()).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("se replie quand la CONSTRUCTION du worker lève", async () => {
    await withWarn(async (warn) => {
      const controller = controllerFor({
        spawnLayoutWorker: () => {
          throw new Error("Worker is not defined");
        },
      });
      const state = await controller.compute(shopGraph, graphConfig, false);
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("se replie sur une erreur du worker LUI-MÊME (script injouable)", async () => {
    const worker = fakeWorker();
    await withWarn(async (warn) => {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
      const pending = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

      // Un `error` du worker ne dit pas à quelle requête il se rapporte : il
      // condamne le worker et solde tout ce qui est en vol, qui se replie.
      worker.fail(new Error("failed to load worker script"));
      const state = await pending;
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("ne passe par AUCUN worker quand l'hôte n'en fournit pas", async () => {
    // Le régime de vitest, de headless, et de tout consommateur qui n'a pas
    // passé `graphLayoutWorkerUrl` : rien ne change, aucun avertissement.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = await controllerFor().compute(shopGraph, graphConfig, false);
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("worker de mise en page — destruction", () => {
  it("termine le worker et solde les calculs en vol SANS les rejouer en processus", async () => {
    const worker = fakeWorker();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
      const pending = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

      controller.destroy();
      expect(worker.terminated()).toBe(1);

      // Le calcul en vol échoue plutôt que de rester en suspens : son appelant
      // (`setView`) doit se terminer, pas geler le bouton qu'il a mis en
      // attente. Et surtout il ne rejoue PAS les secondes de calcul en
      // processus — ce serait le gel qu'on vient d'éviter, pour une instance
      // qui n'existe plus.
      await expect(pending).rejects.toThrow(/destroyed/);
      // Rien n'a été publié, et aucun avertissement de repli n'a été émis : une
      // destruction n'est pas une panne de worker.
      expect(controller.positions()).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("est idempotent", () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    controller.destroy();
    controller.destroy();
    expect(worker.terminated()).toBe(0); // aucun worker n'avait été ouvert
  });
});

describe("worker de mise en page — l'entrée que le worker reçoit", () => {
  it("porte les options du contrôleur, résolues", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({
      spawnLayoutWorker: worker.spawn,
      layoutOptions: { hullPadding: 42 },
    });
    void controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

    const input: GraphLayoutInput = worker.requests[0]!.input;
    expect(input.options.hullPadding).toBe(42);
    // Et le contrôleur apprend la même valeur pour recalculer les disques à la
    // souris : les deux ne peuvent pas diverger.
    expect(controller.hullPadding()).toBe(42);
  });
});
