import { invoke } from "@tauri-apps/api/core";
import type { DataGraphConfig } from "@defsquare/datagraph";

/** What the command line asked for. `"demo"` covers two cases the frontend has
 * no reason to tell apart: running outside Tauri (Vite/e2e), and the binary
 * launched with no argument. */
export type Launch =
  | { mode: "demo" }
  | { mode: "file"; data: unknown; config: DataGraphConfig };

/** Mirror of the Rust `LaunchPayload`: RAW file contents. Rust validated JSON
 * syntax and nothing more; this is where the strings become values, and semantic
 * validation of the config stays with `createDataGraph`. */
interface RawPayload {
  data: string;
  config: string | null;
}

export async function resolveLaunch(): Promise<Launch> {
  // Tauri detection: the internals object only exists inside the WebView.
  if (!("__TAURI_INTERNALS__" in window)) return { mode: "demo" };
  const payload = await invoke<RawPayload | null>("launch_payload");
  if (payload === null) return { mode: "demo" };
  const data: unknown = JSON.parse(payload.data);
  // Without `-c`: an empty config means structure view only. A missing `ids` is
  // impossible on the Rust side (it only sends validated JSON), but an empty
  // config remains the contract of structure mode.
  const config: DataGraphConfig =
    payload.config === null ? { ids: {} } : (JSON.parse(payload.config) as DataGraphConfig);
  return { mode: "file", data, config };
}
