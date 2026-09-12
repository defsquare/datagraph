# @defsquare/datagraph-chrome

The DOM primitives of datagraph's chrome: floating surface, icon button,
unfolding search bar, menu, entity badge, status link, reference button.

**One primitive per module, its stylesheet beside it**, under `src/components/`:

```
src/
  icons.ts              the chrome's nine icons, single source
  dom.ts                the `element()` helper, internal
  chrome.css            entry point: the list of @imports
  index.ts              the public façade
  components/
    float.css           the base, with no factory — a class you put on
    cluster.ts   .css   createCluster, createClusterSeparator
    icon-button.ts .css createIconButton
    findbar.ts   .css   createFindbar
    menu.ts      .css   createMenu, createMenuItem
    badge.ts     .css   createBadge
    status-link.ts .css createStatusLink
    ref-button.ts  .css createRefButton
```

A component's rules live with the code that builds it: you do not add a CSS
state without seeing its factory, nor the other way round. Consumers, for their
part, see only two entry points — the index and `chrome.css`.

```ts
import { createIconButton, createFindbar } from "@defsquare/datagraph-chrome";
import "@defsquare/datagraph-chrome/chrome.css"; // AFTER the tokens
```

## Why this package exists

`apps/design` catalogues the design system. Its graph-components board calls the
renderer's real drawing functions, so a specimen cannot lie about what the
product paints. Its UI-components board could not do the same: the primitives
lived inside `apps/demo`, and the board **copied** them — CSS and SVG paths. Two
sources drift, and nothing breaks when they do.

Both applications now consume this package. The copy is gone, so there is
nothing left to keep in sync.

## What this package does not contain

- **No behaviour.** No disclosure handling, no global listener, no state. The
  factories produce inert DOM. The demo's Escape policy — one level at a time,
  `preventDefault` so the search field is not silently cleared — is a decision
  about ITS two panels.
- **No assemblies.** The toolbar's contents, the menu entries, the structure of
  the detail panel and the status bar belong to the application: those are
  product choices, and hosting them here would make this package the mandatory
  path for every interface change.

## Shape of the package

Private, build-less: the `exports` point straight at `src/`. Both consumers are
Vite applications that compile source. Making it publishable would cost a
`tsup.config.ts` and a public README — nothing structural.

Every factory accepts an `id`: the demo's instances are addressed by id, by its
wiring as much as by its end-to-end tests.

`pnpm --filter @defsquare/datagraph-chrome test` — the factories are tested
under happy-dom, the repo's first DOM environment. What those tests freeze
(classes, ids, ARIA attributes) is the contract the demo and the catalogue now
share.

Decision and rejected alternatives:
[`docs/adr/0029-chrome-primitives-shared-package.md`](../../docs/adr/0029-chrome-primitives-shared-package.md).
