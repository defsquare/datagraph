import { defineConfig } from "vitest/config";

// Les fabriques produisent du DOM : elles se testent dans un document, pas dans
// un navigateur. happy-dom suffit — aucune de ces primitives ne dépend d'une
// mise en page calculée, seulement des classes, ids et attributs ARIA émis.
export default defineConfig({
  test: { environment: "happy-dom" },
});
