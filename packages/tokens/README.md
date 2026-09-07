# @defsquare/data-graph-tokens

Design tokens for [data-graph](https://github.com/defsquare/data-graph): the single
source of truth for colors, fonts, typography, radii, spacing, strokes and motion.

The same values used to live twice — once in the Pixi themes of the renderer, once in
the CSS variables of the demo shell. They now live here, and both sides read from it:

- `@defsquare/data-graph` (renderer) builds its Pixi themes from `defsquare` / `neutral`
  and formats font stacks with `pixiFontStack`.
- the demo shell generates its CSS custom properties from the same tokens, plus the
  DOM-only `chrome` tokens (translucent floating surfaces and shadows, which the canvas
  has no notion of), and formats font stacks with `cssFontStack`.

Zero runtime dependencies, side-effect free, usable outside the DOM (a Node script can
import it to generate a stylesheet).

```ts
import { chrome, cssFontStack, defsquare, pixiFontStack, radii } from "@defsquare/data-graph-tokens";

defsquare.light.surface.canvas; // "#eef0f3"
pixiFontStack(defsquare.fonts.body); // "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif"
cssFontStack(defsquare.fonts.body); // '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif'
```

Font family **names** are contractual: the demo's `@font-face` rules and the renderer's
BitmapFont measurement reference them by these exact names.

## License

MIT
