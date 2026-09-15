# ADR-0040 — The website is served by an assets-only Cloudflare Worker

**Date**: 2026-09-15
**Status**: Accepted

## Context

ADR-0039 created the website and deliberately left deployment out of scope:
`hugo --minify --gc` produces `public/`, and nothing said how `public/`
reaches `datagraph.defsquare.com`. The project already lives on Cloudflare —
the release tarballs sit in an R2 bucket behind `dl.datagraph.defsquare.com`
(ADR-0026), and `defsquare.com` is a zone in the account — so the question was
never which CDN, only which Cloudflare product and which trigger.

Workers Builds can watch the GitHub repository, run a build in a container
that ships Hugo extended preinstalled (pinnable with a `HUGO_VERSION`
variable), and deploy on push to `main` — with per-branch preview deployments
for free. A Worker with an `assets` block and no `main` script is a pure
static host: no code to write, no runtime to maintain.

## Decision

**The site is a Worker with static assets only**, defined by
`website/wrangler.jsonc`: `assets.directory` points at `public/`,
`not_found_handling` serves Hugo's own `404.html`, and a
`custom_domain` route claims `datagraph.defsquare.com`. There is no Worker
script and none is anticipated — the site is static by construction.

**Builds and deploys are Workers Builds' job**, from the git integration:
root directory `/website`, build command
`git submodule update --init --recursive && hugo --minify --gc`, deploy
command `npx wrangler deploy`, and `npx wrangler versions upload` for
non-production branches. The submodule step is explicit because the Workers
Builds documentation does not promise submodule checkout, and Hextra lives at
`website/themes/hextra` as one; the command is a no-op when the clone already
has it. `HUGO_VERSION` is pinned as a build variable to the version the site
is developed against, rather than floating on the image's default.

## Alternatives considered

- **Cloudflare Pages.** The historical product for exactly this shape, and it
  would work. Cloudflare's own migration guides now point from Pages to
  Workers static assets; starting a new project on the legacy rail buys
  nothing.
- **Deploy from `bin/release.sh`, like the binary.** The release script is
  the wrong trigger: documentation changes ship with ordinary merges to
  `main`, not with binary releases, and coupling them would leave the site
  stale between versions.
- **A GitHub Action running wrangler.** Equivalent result, one more CI system
  to hold a Cloudflare token. Workers Builds keeps the credential inside the
  Cloudflare account and the configuration next to the site it deploys.

## Consequences

- **`website/wrangler.jsonc` is the deployment's source of truth** — the
  Worker name, the assets directory and the custom domain live in the repo,
  so the dashboard form carries only the build trigger.
- **Preview deployments exist for branches** touching the website, via
  `wrangler versions upload`; their preview URLs serve the site under a
  generated host, so absolute URLs derived from `baseURL` keep pointing at
  production — acceptable for previews.
- **The build re-fetches the Hextra submodule from GitHub on every build**;
  an imfing/hextra outage becomes a (transient) build failure. The pin to a
  commit means an upstream force-push is the only way the content can drift.
- **`datagraph.defsquare.com` DNS is created by the custom-domain route** on
  first deploy; nothing manual remains, which closes the "has to resolve"
  loose end ADR-0039 recorded.
