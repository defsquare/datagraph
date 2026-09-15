# datagraph website

**One Hugo site, one build, one server** — the landing page at `/` and the
documentation at `/docs/`.

```bash
hugo server -D --port 1315   # http://localhost:1315/  and  /docs/
hugo --minify --gc           # → public/
```

`pnpm --filter @defsquare/datagraph-website build` runs the same build, but
skips with a notice when `hugo` is not on `PATH`, so a Node-only environment
stays green.

The two halves look nothing alike and that is deliberate: the landing page is
themeless and runs on the Defsquare Design System, the documentation runs on
[Hextra](https://github.com/imfing/hextra) (vendored at `themes/hextra` as a
git submodule — `git submodule update --init` after a clone). They share one
config, one content tree and one output directory, so a CLI change and its
documentation ship in one merge request and one deployment.

| Path | What lives here |
|---|---|
| `content/_index.md` | the landing page, entirely: headline, lead, the install line, the two calls to action and the trailer video with its caption. `type: landing` is what selects the themeless shell. There is no body — every field is front matter |
| `content/docs/` | the documentation: a **flat** list of pages ordered by `weight`, plus `_index.md` as the docs home (see ADR-0039 for why there are no Diátaxis quadrants) |
| `layouts/landing/` | the landing shell — `baseof.html`, `home.html`, and `_markup/` render hooks. No theme, no JavaScript |
| `layouts/_partials/landing/` | the landing's three partials, namespaced |
| `assets/css/colors_and_type.css` | the design system's token layer, copied from the Defsquare Design System project |
| `assets/css/landing.css` | layout only — every colour, size and space is a token |
| `static/fonts/` | IBM Plex Sans Condensed, self-hosted. EB Garamond and Fira Code come from Google Fonts, as the design system specifies |
| `static/img/` | the datagraph lockup (light and inverse), the Defsquare logo, the favicon |
| `static/video/` | the landing's trailer, `trailer.mp4` — this copy is the tracked one |
| `static/favicon.svg` | where Hextra looks for it; `static/img/favicon.svg` is the same file, where the landing shell looks |
| `themes/hextra/` | the documentation theme, a git submodule |

Everything under `static/img/` is **copied from `packages/tokens/brand/`**,
the source of truth for the marks. Re-copy rather than edit in place.

## How two shells share one site

Hugo resolves templates by lookup order, and a project template always beats a
theme's. A landing `layouts/baseof.html` would therefore silently wrap every
documentation page as well. Three rules keep them apart:

1. **The landing shell is scoped by type.** `content/_index.md` declares
   `type: landing`, so `layouts/landing/baseof.html` and
   `layouts/landing/home.html` are found for it and for nothing else. Every
   documentation page falls through to Hextra's.
2. **The landing partials are namespaced.** `layouts/_partials/landing/*.html`
   — `footer.html` in particular would otherwise shadow Hextra's.
3. **The landing has its own Markdown render hooks**, in
   `layouts/landing/_markup/`. Hextra's emit Tailwind `hx:` utility classes,
   a code-block copy button and heading permalink anchors, all styled by a
   stylesheet the landing shell does not load; scoped hooks emit plain
   `<h2>`, `<pre><code>` and `<a>` instead.

Syntax highlighting follows the same principle rather than a global switch:
`markup.highlight.noClasses: false` makes colour a stylesheet concern, the
documentation loads Hextra's Chroma sheet and gets colour, and the landing —
which does not load it — gets code in one colour, as the design system asks.

Hugo concatenates the two landing stylesheets (tokens first, so the design
system's `@import` rules stay at the top of the sheet), then minifies and
fingerprints them into one request.

## Links between the two halves

Landing → documentation goes through `params.docsBase` in `hugo.yaml`
(`/docs/` today): the nav and footer entries carry `doc: "config/"`, never a
full path, so moving the documentation is a one-line change.

Documentation → documentation links are written site-absolute and in full
(`/docs/config/`). They say what they mean, and a page that moves breaks
loudly rather than resolving to something else.
