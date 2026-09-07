# ADR-0029 — Chrome primitives as a shared private package

**Date**: 2026-09-07
**Status**: Accepted

## Context

`apps/design` (ADR-0028) catalogues the design system. Its "graph components"
view calls the renderer's real drawing functions, so a specimen cannot lie about
what the product paints. Its "UI components" view could not do the same: the
chrome primitives — floating surface, icon button, findbar, menu item, entity
badge — lived only inside `apps/demo`, styled by rules anchored on page ids and
built from markup written inline in `index.html`. The view therefore *recopied*
them: ~360 lines of CSS and nine SVG paths, duplicated by hand.

That duplication is the defect a catalogue exists to remove. Two sources drift,
and nothing fails when they do: the demo's chrome can change while the catalogue
keeps showing a component that no longer exists.

Inspection showed the extraction was cheaper than feared. The primitives were
already class-based (`.float`, `.ibtn`, `.cluster`, `.findbar`, `.menu-item`);
only three were styled through ids (`#search`, `#match-counter`,
`#selection-type`). The ids that matter are instance hooks, not style hooks —
eighteen of them are asserted by the Playwright e2e suite.

## Decision

A third workspace package, `packages/chrome` (`@defsquare/data-graph-chrome`),
holding the chrome's **visual vocabulary** and nothing else:

- `src/chrome.css` — the primitive rules, moved verbatim from
  `apps/demo/src/style.css`.
- `src/icons.ts` — the nine SVG paths, previously inline in `index.html` and
  copied again in the playground.
- markup factories — `createIconButton`, `createFindbar`, `createMenu`,
  `createBadge`, `createRefButton`, and their neighbours.

`"private": true` with `exports` pointing straight at `src/`: both consumers are
Vite applications that compile source, so there is no tsup build, no `dist/`, and
no public API to keep stable. Both `apps/demo` and `apps/design` consume it.

The three id-styled primitives become classes (`.findbar-input`,
`.findbar-counter`, `.badge`); every existing id stays on its instance, and the
factories take an optional `id`.

## Alternatives considered

- **Publish it alongside the renderer.** Rejected as speculative: a consumer
  embedding the canvas builds their own chrome today, and publishing would buy a
  build, a public README, and version discipline for no current reader.
- **Ship assemblies too** (`createToolbar`, `createDetailPanel`). Rejected: the
  package would inherit product decisions — which buttons, which menu entries —
  and become the mandatory path for every UI change in the demo.
- **Ship the disclosure behaviour** (aria-expanded, outside-click, Escape) from
  `chrome.ts`. Rejected: the catalogue renders `aria-expanded="true"` as a static
  state and needs no behaviour, so the code would be *moved*, not *shared*. The
  demo's Escape policy — one level at a time, `preventDefault` so the search
  field is not silently cleared — is a decision about those two panels, not a
  property of a primitive.
- **A freshness test over the copies**, as `packages/tokens` (ADR-0027) has for
  its generated CSS. Rejected here: the selectors differ by construction between
  the two sheets, so no byte comparison is possible — and removing the
  duplication is strictly better than watching it.

## Consequences

- The catalogue's UI view joins the graph view's regime: it shows the real
  component, and a change to the chrome reaches it without anyone remembering to
  copy anything.
- The monorepo gains its first DOM test environment (`happy-dom`, in
  `packages/chrome`): the factories' output — classes, ids, ARIA attributes — is
  the contract the demo and the catalogue now share.
- The demo's chrome markup moves from static HTML to TypeScript construction.
  The chrome therefore appears after the module runs; harmless, since the canvas
  already requires JS and the affected panels start `hidden`.
- The Playwright e2e suite becomes the integration net for this refactor and must
  pass unchanged. It is not part of `pnpm test` — `pnpm --filter demo e2e` has to
  be run deliberately.
- The boundary drawn here (primitives shared, assemblies owned by the app) is the
  line the catalogue advertises. Anything the catalogue cannot show — the toolbar
  as a whole, the detail panel, the status bar — is now explicitly the demo's.
