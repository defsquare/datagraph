# @defsquare/datagraph-tokens

Design tokens for [datagraph](https://gitlab.com/defsquare/datagraph): the single
source of truth for colors, fonts, typography, radii, spacing, strokes and motion.

The same values used to live twice — once in the Pixi themes of the renderer, once in
the CSS variables of the demo shell. They now live here, and both sides read from it:

- `@defsquare/datagraph` (renderer) builds its Pixi themes from `defsquare` / `neutral`
  and formats font stacks with `pixiFontStack`.
- the demo shell generates its CSS custom properties from the same tokens, plus the
  DOM-only `chrome` tokens (translucent floating surfaces and shadows, which the canvas
  has no notion of), and formats font stacks with `cssFontStack`.

Zero runtime dependencies, side-effect free, usable outside the DOM (a Node script can
import it to generate a stylesheet).

```ts
import { chrome, cssFontStack, defsquare, pixiFontStack, radii } from "@defsquare/datagraph-tokens";

defsquare.light.surface.canvas; // "#eef0f3"
pixiFontStack(defsquare.fonts.body); // "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif"
cssFontStack(defsquare.fonts.body); // '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif'
```

Font family **names** are contractual: the demo's `@font-face` rules and the renderer's
BitmapFont measurement reference them by these exact names.

## CSS output

The `./css` subpath renders the tokens as CSS custom properties. It is kept out of the
index so the index stays pure data for the renderer, which has no use for a string of CSS.

```ts
import { renderTokensCss } from "@defsquare/datagraph-tokens/css";
```

`apps/demo/src/tokens.css` is generated from it and committed (Vite imports static CSS, it
cannot run the generator). Regenerate with `pnpm --filter @defsquare/datagraph-tokens
generate:css`; a freshness test fails if the committed file drifts from the tokens.

## License

MIT
