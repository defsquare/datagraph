import type { DataGraph, DataGraphConfig } from "@defsquare/datagraph";
import { shopData, shopConfig, bigShop, bigShopConfig } from "./sample-data";

// Everything that exists ONLY IN DEMO MODE — the sample dataset, its generator
// and the small/large toggle — lives here, and this module is reached only
// through `main.ts`'s dynamic import. That is what guarantees that in file mode
// (`datagraph data.json`) `sample-data.ts` is neither downloaded nor evaluated:
// its generator would build ~4000 nodes nobody needs.

/** The dataset the demo loads on startup. */
export const demoDataset: { data: unknown; config: DataGraphConfig } = {
  data: shopData,
  config: shopConfig,
};

// The large dataset is generated ON DEMAND, on the first click, then memoized:
// building it at module load would cost ~4000 nodes on every startup, including
// visits that never touch the toggle. `bigShop` is deterministic, so memoizing
// only avoids recomputing the very same thing.
let bigShopData: ReturnType<typeof bigShop> | undefined;

function bigDataset(): ReturnType<typeof bigShop> {
  bigShopData ??= bigShop(4000);
  return bigShopData;
}

/**
 * Dataset toggle: exercises `setData()` with the small `shopData` against a
 * generated `bigShop(4000)` (4061 logical nodes exactly: 78 customers, 234
 * orders, 30 products, 8 categories — 350 entities).
 *
 * The config is passed EXPLICITLY in both directions: the small dataset declares
 * `reviews[*].customerId`, which the large one — having no reviews — cannot
 * satisfy, and reusing the same config would surface a legitimate but confusing
 * `unresolved-reference` in the status bar. The "setData(data) without a config
 * reuses the current one" path is therefore no longer exercised here; a
 * dedicated e2e test covers it (smoke.spec.ts).
 *
 * `onSwapped` brings the host interface (search, panel, status bar) back in step
 * with the state `setData()` has just reset on the renderer side.
 */
export function setupDatasetToggle(graph: DataGraph, onSwapped: () => void): void {
  const toggleDatasetBtn = document.getElementById("toggle-dataset") as HTMLButtonElement | null;
  if (!toggleDatasetBtn) return;

  let usingBigDataset = false;

  toggleDatasetBtn.addEventListener("click", () => {
    void (async () => {
      toggleDatasetBtn.disabled = true;
      try {
        usingBigDataset = !usingBigDataset;
        await graph.setData(
          usingBigDataset ? bigDataset() : shopData,
          usingBigDataset ? bigShopConfig : shopConfig,
        );
        toggleDatasetBtn.textContent = usingBigDataset ? "Jeu de données réduit" : "Jeu de données étendu (4000)";
        onSwapped();
      } finally {
        toggleDatasetBtn.disabled = false;
      }
    })();
  });
}
