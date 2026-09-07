import { defineConfig } from "vitest/config";

// The factories produce DOM: they are tested in a document, not in a browser.
// happy-dom is enough — none of these primitives depends on a computed layout,
// only on the classes, ids and ARIA attributes emitted.
export default defineConfig({
  test: { environment: "happy-dom" },
});
