# ADR-0038 — The repository's home is GitHub, the marketplace is the org's

**Date**: 2026-09-14
**Status**: Accepted

## Context

Everything ADR-0033, ADR-0034 and ADR-0035 built to get `datagraph` into
somebody else's hands assumes a repository a stranger can read. The README is
the install page and links into the tree; the non-arm64-macOS path is "clone it
and build it" (the skill says so, ADR-0035); and `/plugin marketplace add`
fetches a git URL that has to resolve without credentials.

The repository lived in the `defsquare` group on GitLab, which is private.
GitLab caps a project's visibility at its group's: a project inside a private
group cannot be made public. So "just flip this project to public" was never on
the table — the only way to publish the project was to publish the whole group's
namespace, for one project's distribution needs.

The plugin marketplace had a second, smaller problem. ADR-0035 put
`.claude-plugin/marketplace.json` in this repository, naming the marketplace
`defsquare` with a single plugin sourced at `"./"`. That is a marketplace named
after the organisation living inside one product's repo: the second defsquare
plugin either gets bolted into this repository or ships a second marketplace
also called `defsquare`, and a user who adds both gets a name collision.

## Decision

The repository's home is **github.com/defsquare/datagraph**, public. Every
repository URL follows: the `repository` fields of the root and package
manifests, `Cargo.toml`, the formula template's `homepage`, the skill's
build-from-source pointer. Deep links from the package READMEs into the tree
become plain relative links rather than host-shaped ones — they survive the next
move, and npm rewrites them against `repository.url` + `directory` anyway.

**The release pipeline is deliberately not revisited.** `bin/release.sh` on a
maintainer's Mac, the tarball on Cloudflare R2, the git tag, the formula pushed
to `defsquare/homebrew-tap` — that is what shipped v0.1.0 and it stays. Being on
GitHub makes two things *available* that were not: GitHub Releases as a host,
and free-tier macOS runners that could build the universal binary in CI. Both
are recorded here as a possible future simplification. Neither is taken now:
nothing about the pipeline is broken, and swapping a working release path in the
same breath as a host move is how a release stops working.

**The `defsquare` marketplace moves out of this repository**, into
**github.com/defsquare/claude-marketplace** — an org-level index that references
each plugin where it lives, which is exactly the shape `defsquare/homebrew-tap`
already has for formulas (ADR-0034). This repository keeps
`.claude-plugin/plugin.json`, which is what makes it a plugin;
`.claude-plugin/marketplace.json` is deleted. Install becomes the short form:

```
/plugin marketplace add defsquare/claude-marketplace
/plugin install datagraph@defsquare
```

## Alternatives considered

- **Make the GitLab group public.** The cheapest edit, and the wrong blast
  radius: it opens the organisation's whole namespace — every current and future
  project in it — to satisfy one project's README links.
- **A public GitLab mirror of a private home.** Keeps the group closed and gets
  a readable URL, at the price of two remotes to keep in sync forever, and a
  clone URL that is not where the work happens. ADR-0035 rejected a GitHub
  mirror for the marketplace on the same grounds; the reasoning does not improve
  when the mirror carries the whole repository.
- **Keep the marketplace in this repository.** Free today, and it costs the
  moment a second defsquare plugin exists: two marketplaces named `defsquare`,
  or one product's repo hosting the org's plugin index. A per-product index is
  the shape ADR-0034 already walked away from when it put the tap in its own
  repo instead of shipping formulas from here.

## Consequences

- **This revises facts recorded in ADR-0033, ADR-0034 and ADR-0035** — GitLab as
  the home, the long URL install form, the marketplace inside this repo. Those
  ADRs are left as written, statuses unchanged: their actual decisions (a local
  release script publishing to R2, a Homebrew tap on GitHub, the skill versioned
  with the binary it documents) all survive the move intact. This ADR is where
  the host changed, and where to look when an older one names GitLab.
- **The GitLab project stays as a historical remote** until the maintainer
  retires it. It is no longer `origin` and is not kept in sync.
- **The tag `v0.1.0` has to be pushed to the new origin**, or `bin/release.sh`'s
  next tag lands in a repository with no history of the previous one.
- **The tap needs the same URL fix** — its README and the already-published
  formula's `homepage` still point at GitLab. That repository is handled
  separately; `Formula/datagraph.rb.tmpl` here is already corrected, so the next
  release renders the right `homepage` on its own.
- **The install line gets shorter.** `/plugin marketplace add` takes an
  `owner/repo` short form for GitHub, which is precisely the affordance
  ADR-0035 noted GitLab could not offer.
