# ADR-0039 — A documentation website in the repository, flat rather than quadranted

**Date**: 2026-09-14
**Status**: Accepted

## Context

ADR-0038 put the repository on GitHub, public, because everything built to get
`datagraph` into somebody else's hands assumes a repository a stranger can read.
That made the README the product's only front door, and it is now carrying more
than a README should: the pitch, two screenshots, three install routes, the
`ids` / `refs` / `groups` contract, the `--check` exit-code rule, the plugin
install, the monorepo layout, the development commands and the release
procedure. A reader who wants to install the binary and open a file reads past
all of it, and a maintainer adding one paragraph makes the file longer for
everybody.

The information is also split across places a stranger has no reason to find:
the selector grammar is best stated in `skills/datagraph/SKILL.md`, the
structure view's preview budget in `packages/renderer/README.md`, the exit codes
in `apps/demo/README.md`, the graph view's layout in `docs/graph-view.md`. Those
files are right where they are — they document the code beside them — but none
of them is a page you send somebody to.

The sister project, `codegraph`, already solved the same problem: one Hugo site
where a themeless landing page on the Defsquare Design System sits at `/` and
Hextra-themed documentation at `/docs/`, coexisting by scoping rather than by
being two sites. The mechanism is proven and the design system layer is
transferable verbatim.

## Decision

**The documentation website lives in this repository, at `website/`**, as one
Hugo site built by one command, and it reuses codegraph's two-shell mechanism
exactly: the landing page is selected by `type: landing` in
`content/_index.md`, its partials are namespaced under
`layouts/_partials/landing/`, and it carries its own Markdown render hooks so
Hextra's Tailwind-flavoured output never reaches a page that does not load
Hextra's stylesheet. Hextra is vendored as a git submodule, pinned to the same
commit codegraph pins. In-repo, because documentation that ships in the same
merge request as the change it describes is documentation that stays true — the
same reasoning ADR-0035 used to version the skill with the binary.

**The documentation is a flat list of pages, not the four Diátaxis quadrants.**
Seven pages — install, getting started, config, check, views, plugin, API —
ordered by `weight`, all directly under `content/docs/`. Codegraph has sixty
pages and four quadrants earn their keep there; seven pages spread over four
sections would give sections of one and two pages, a navigation tree taller than
the content it indexes, and a reader forced to guess which quadrant holds the
selector grammar. Diátaxis stays as a **writing discipline** — each page is
deliberately one mode, and "getting started" is a tutorial while "config" is
reference — but it is not imposed as a directory structure. Promoting the flat
list to quadrants later is a file move plus four `_index.md`, which is why this
is cheap to defer and expensive to do early.

**The site is published at `datagraph.defsquare.com`**, which is what `baseURL`
says. **How it gets deployed is out of scope here**: no pipeline, no host, no
DNS record is part of this decision. `hugo --minify --gc` produces `public/`,
and `website/package.json` wraps it in a `build` script guarded on `hugo` being
on `PATH` so a Node-only environment stays green.

## Alternatives considered

- **Keep everything in the README.** Free, and already the status quo that
  prompted this. A 330-line README is not a front door; it is an archive that
  a first-time reader has to skim past to find `brew install`.
- **A GitHub Pages site from `/docs`, no Hugo.** Fewer moving parts, and it
  gives up the landing page entirely — the design-system hero with the trailer
  video is the thing that says what this tool is before any prose does.
  A raw Markdown tree cannot carry it.
- **Two sites, one for the landing page and one for the docs.** Two builds, two
  deployments and two chances for the version skew between the pitch and the
  documentation that in-repo docs exist to prevent. Codegraph rejected this and
  its README says why; nothing about a smaller doc set improves the trade.
- **The four Diátaxis quadrants anyway, for symmetry with codegraph.** Symmetry
  between two projects is not a reader's concern. It would buy consistency for
  maintainers at the cost of a four-level navigation over seven pages.
- **Generate the docs from the package READMEs.** Tempting, since that is where
  the text lives today. Those READMEs are written for a developer inside the
  tree — relative links, build commands, test-file references — and the
  transformation that would make them read as product documentation is the
  writing, not a script.

## Consequences

- **The READMEs stay, and stay authoritative for the code beside them.** The
  website distils; it does not replace. The root README is where a contributor
  looks, the website is where a user looks, and the two will drift — a known
  cost, mitigated by the site linking into the tree on GitHub for anything
  deeper than a page covers.
- **`website` joins `pnpm-workspace.yaml`**, so `pnpm build`, `pnpm test` and
  `pnpm typecheck` reach it. `test` and `typecheck` are `true`: there is nothing
  to typecheck and no test worth the dependency, and a missing script would
  break `pnpm -r`.
- **A clone now needs `git submodule update --init` before the site builds.**
  Nothing else in the repository has a submodule, so this is a new step for
  anyone touching `website/`. It is in the website's own README.
- **The brand assets are duplicated into `static/img/`.** `packages/tokens/brand`
  stays the source of truth (ADR-0036), and these copies are made by hand rather
  than by a generator, unlike the ones `generate:brand` writes into
  `apps/*/public/`. A generator and its freshness test would be the consistent
  move; with four files that change about once a year, it is not yet worth the
  script it would take.
- **Two pages document something that does not exist yet** — the npm packages,
  on `/docs/api/` and in `/docs/install/`. Both say so plainly rather than
  showing an install command that would fail. When the packages ship, those are
  the two places to edit.
- **`datagraph.defsquare.com` has to resolve** before any of this is reachable,
  and that is not done here. Until it is, the site builds and is read locally.
