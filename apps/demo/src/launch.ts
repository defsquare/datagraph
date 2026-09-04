import { invoke } from "@tauri-apps/api/core";
import type { DataGraphConfig } from "@defsquare/data-graph";

/** Ce que la ligne de commande a demandé. `"demo"` couvre deux cas que le
 * frontend n'a pas à distinguer : hors Tauri (Vite/e2e) et binaire lancé sans
 * argument. */
export type Launch =
  | { mode: "demo" }
  | { mode: "file"; data: unknown; config: DataGraphConfig };

/** Miroir du `LaunchPayload` Rust : contenus BRUTS des fichiers. Rust n'a
 * validé que la syntaxe JSON ; c'est ici que les chaînes deviennent des
 * valeurs, et la validation sémantique de la config reste à `createDataGraph`. */
interface RawPayload {
  data: string;
  config: string | null;
}

export async function resolveLaunch(): Promise<Launch> {
  // Détection Tauri : l'objet d'internals n'existe que dans la WebView.
  if (!("__TAURI_INTERNALS__" in window)) return { mode: "demo" };
  const payload = await invoke<RawPayload | null>("launch_payload");
  if (payload === null) return { mode: "demo" };
  const data: unknown = JSON.parse(payload.data);
  // Sans `-c` : config vide = vue structure seule (le cœur l'accepte depuis
  // que `empty-config` a disparu).
  const config: DataGraphConfig =
    payload.config === null ? { entities: {} } : (JSON.parse(payload.config) as DataGraphConfig);
  return { mode: "file", data, config };
}
