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
 * THE LAYOUT WORKER'S PROTOCOL, tested without a browser.
 *
 * That is possible — and it is the whole benefit of the shape chosen — because
 * the controller does not know `Worker`: it receives a FACTORY
 * (`GraphViewHooks.spawnLayoutWorker`), and `create.ts` is the only place in the
 * repo that writes `new Worker`. So we inject a fake worker here that answers
 * exactly what we tell it to, and we check the four things the protocol promises:
 *
 *  1. a correct response is applied, and the layout coming out of it is the
 *     engine's — not an approximation rebuilt sideways;
 *  2. a response from a STALE generation is dropped without publishing or
 *     resolving anything;
 *  3. a failure (error message, unrunnable worker) warns ONCE and falls back to
 *     the in-process engine, PERMANENTLY;
 *  4. `destroy()` terminates the worker and settles whatever is in flight.
 *
 * The fake worker computes for real, through `layoutFromInput`: that is what
 * makes assertion 1 interesting — the output must be identical to the in-process
 * path's, serialization included.
 */

const graphConfig: DataGraphConfig = { ...shopConfig, groups: ["Customer"] };
const shopGraph = buildGraph(shopData, graphConfig);

/**
 * A fake worker driven by hand: nothing leaves on its own.
 *
 * `requests` keeps what was posted, `flush()` answers the oldest pending request,
 * and `reply()` lets us write any response at all — including a generation that
 * was never asked for, which is the heart of assertion 2.
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
    /** Answers the request at index `i` by actually computing the layout, like
     * the real worker: same flattening, same content. */
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

describe("layout worker — the nominal path", () => {
  it("extracts on the main thread and posts a CLONEABLE input", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);

    // Extraction is synchronous once the module is loaded; one turn of the loop
    // is enough to see it leave.
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    const request = worker.requests[0]!;
    expect(request.gen).toBe(1);
    // The property that matters: what leaves survives a `postMessage`. A `Graph`,
    // a `Map` of nodes or a leaked function would show up right here.
    expect(structuredClone(request.input)).toEqual(request.input);
    // And it really is the engine's input, not an object made up for the
    // occasion.
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

  it("returns EXACTLY the layout of the in-process engine", async () => {
    const worker = fakeWorker();
    const viaWorker = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = viaWorker.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.flush();
    const workerState = await pending;

    const inProcessState = await controllerFor().compute(shopGraph, graphConfig, false);

    // Serializing to tuples and rehydrating must lose nothing — not a card, not a
    // decimal.
    expect([...workerState.layout.positions.entries()].sort()).toEqual(
      [...inProcessState.layout.positions.entries()].sort(),
    );
    expect(workerState.layout.clusters).toEqual(inProcessState.layout.clusters);
  });

  it("returns MUTABLE envelopes and rects: dragging mutates them in place", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.flush();
    controller.publish(await pending);

    // What `translateCluster` does on every frame of an aggregate move. A frozen
    // object would fail here, and NOWHERE else.
    const cluster = controller.clusters()[0]!;
    cluster.cx += 10;
    expect(controller.clusters()[0]!.cx).toBe(cluster.cx);
    const rect = controller.positions()!.get("/customers/0")!;
    rect.x += 7;
    expect(controller.positions()!.get("/customers/0")!.x).toBe(rect.x);
  });

  it("opens only ONE worker, reused from one computation to the next", async () => {
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
    // Generations are monotonic: two requests never share one.
    expect(worker.requests.map((r) => r.gen)).toEqual([1, 2]);
  });

  it("opens NO worker as long as nothing is laid out", () => {
    const worker = fakeWorker();
    controllerFor({ spawnLayoutWorker: worker.spawn });
    expect(worker.spawns()).toBe(0);
  });
});

describe("layout worker — generations", () => {
  it("DISCARDS a response whose generation matches no request", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    const pending = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

    // A response from a stale generation — typically a `setData`'s, whose
    // computation was settled in the meantime. It must neither resolve the
    // request in flight nor publish anything.
    let settled = false;
    void pending.then(() => (settled = true));
    worker.reply({ gen: 999, ok: true, positions: [["/customers/0", 1, 2, 3, 4]], clusters: [] });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(controller.positions()).toBeUndefined();

    // …and the real response, for its part, goes through.
    worker.flush();
    await expect(pending).resolves.toBeDefined();
  });

  it("pairs each response with ITS request, even when they arrive out of order", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });

    const first = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
    const second = controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));

    // The second answers first: without matching by generation, it would resolve
    // the first one.
    worker.flush(1);
    worker.reply({ gen: worker.requests[0]!.gen, ok: false, message: "boom" });

    await expect(second).resolves.toBeDefined();
    // The first did receive ITS failure, not the other's success. The in-process
    // fallback saves it, but another test is the one that says so.
    await expect(first).resolves.toBeDefined();
  });
});

describe("layout worker — permanent fallback", () => {
  /** The controller warns on `console.warn`; we silence it and read it. */
  function withWarn<T>(run: (warn: ReturnType<typeof vi.spyOn>) => Promise<T>): Promise<T> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return run(warn).finally(() => warn.mockRestore());
  }

  it("falls back in process when the worker answers with an error, and warns only once", async () => {
    const worker = fakeWorker();
    await withWarn(async (warn) => {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });

      const first = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
      worker.reply({ gen: worker.requests[0]!.gen, ok: false, message: "layout exploded" });

      // The layout arrives anyway: this is the in-process engine.
      const state = await first;
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("graphLayoutWorkerUrl");
      // The worker is terminated, not left running.
      expect(worker.terminated()).toBe(1);

      // PERMANENT: the next computation does not go back through the worker, and
      // does not warn a second time.
      const second = await controller.compute(shopGraph, graphConfig, true);
      expect(second.layout.clusters).toHaveLength(2);
      expect(worker.requests).toHaveLength(1);
      expect(worker.spawns()).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("falls back when CONSTRUCTING the worker throws", async () => {
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

  it("falls back on an error from the worker ITSELF (unrunnable script)", async () => {
    const worker = fakeWorker();
    await withWarn(async (warn) => {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
      const pending = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

      // An `error` from the worker does not say which request it relates to: it
      // condemns the worker and settles everything in flight, which falls back.
      worker.fail(new Error("failed to load worker script"));
      const state = await pending;
      expect(state.layout.clusters).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it("goes through NO worker when the host provides none", async () => {
    // The regime of vitest, of headless, and of any consumer that did not pass
    // `graphLayoutWorkerUrl`: nothing changes, no warning.
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

describe("layout worker — destruction", () => {
  it("terminates the worker and settles the in-flight computations WITHOUT replaying them in process", async () => {
    const worker = fakeWorker();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
      const pending = controller.compute(shopGraph, graphConfig, false);
      await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

      controller.destroy();
      expect(worker.terminated()).toBe(1);

      // The computation in flight fails rather than hanging: its caller
      // (`setView`) must finish, not freeze the button it left pending. And above
      // all it does NOT replay those seconds of computation in process — that
      // would be the very freeze we just avoided, for an instance that no longer
      // exists.
      await expect(pending).rejects.toThrow(/destroyed/);
      // Nothing was published, and no fallback warning was emitted: a destruction
      // is not a worker failure.
      expect(controller.positions()).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("is idempotent", () => {
    const worker = fakeWorker();
    const controller = controllerFor({ spawnLayoutWorker: worker.spawn });
    controller.destroy();
    controller.destroy();
    expect(worker.terminated()).toBe(0); // no worker had been opened
  });
});

describe("layout worker — the input the worker receives", () => {
  it("carries the controller's options, resolved", async () => {
    const worker = fakeWorker();
    const controller = controllerFor({
      spawnLayoutWorker: worker.spawn,
      layoutOptions: { hullPadding: 42 },
    });
    void controller.compute(shopGraph, graphConfig, false);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(1));

    const input: GraphLayoutInput = worker.requests[0]!.input;
    expect(input.options.hullPadding).toBe(42);
    // And the controller learns the same value for recomputing discs under the
    // mouse: the two cannot diverge.
    expect(controller.hullPadding()).toBe(42);
  });
});
