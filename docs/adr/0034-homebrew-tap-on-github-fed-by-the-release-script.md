# ADR-0034 — A Homebrew tap on GitHub, fed by the release script

**Date**: 2026-09-12
**Status**: Accepted

## Context

ADR-0033 gave the project a download URL: `bin/release.sh` publishes a
universal, ad-hoc signed binary to a public Cloudflare R2 bucket, and the
documented install is a `curl | tar` one-liner. That leaves one thing
unresolved — `curl`
installs nothing that knows its own version, so there is no upgrade path beyond
running the command again.

The pattern is not new to defsquare. specy, a sibling project, distributes its
macOS binary through a Homebrew tap whose formula is rendered from a `.rb.tmpl`
with three `sed` substitutions and pushed by its own local `bin/release.sh`
(its ADR-0015). ADR-0033 adopted that project's hosting too, so nothing differs
any more: the template lives beside the code, the rendering is
`sed`, and the artifact is published before the formula so the formula never
points at something that does not exist.

## Decision

The formula's source of truth is `Formula/datagraph.rb.tmpl`, in this
repository, next to the code whose version it describes. `bin/release.sh`
renders it in its last phase — version, `sha256` of the tarball it just built,
and a URL pinned to the **versioned** R2 key rather than the stable
`datagraph-macos.tar.gz` one — writes the result into a local checkout of the tap
(`DATAGRAPH_TAP_DIR`), commits `datagraph <version>` and pushes.

The tap is a **shared** repository, **`defsquare/homebrew-tap`**, and it stays
on **GitHub even though the code lives on GitLab**. That is deliberate, and it
is the trade specy made: `brew install defsquare/tap/datagraph` is shorthand
that only resolves to a GitHub repository named `homebrew-*`. A tap hosted on
GitLab works, but forces every user through the verbose
`brew tap <name> <url>` form first. A repository holding one 18-line file is a
small price for the idiomatic install line.

Because the script runs on the maintainer's machine, the push is authenticated
by whatever git credentials that machine already has for GitHub. There is no
token to store on either side.

The formula declares `depends_on :macos` and nothing about the architecture —
the artifact is universal, which is precisely what ADR-0033 bought. Users get:

```bash
brew install defsquare/tap/datagraph   # or: brew tap defsquare/tap && brew install datagraph
brew upgrade datagraph
```

## Alternatives considered

- **A per-tool tap, `defsquare/homebrew-datagraph`.** specy's choice, and the
  obvious one when a tap is the first of its kind. It stops being obvious at
  the second tool: one repository per binary multiplies taps inside the same
  organisation, each with its own `brew tap` line to remember.
  `defsquare/homebrew-tap` gives the org one namespace, and specy can move its
  formula into it whenever that is convenient.
- **A tap on GitLab, keeping everything under one roof.** Consistent with
  ADR-0033's "one home for the code", and it costs the idiomatic install: brew
  resolves `user/tap/formula` against GitHub only, so every user would have to
  run `brew tap defsquare/tap https://gitlab.com/...` before installing
  anything. The tap is not code, it is a distribution endpoint; hosting it
  where the package manager expects it is the whole job.
- **homebrew-core.** Removes the tap step entirely, and in exchange demands
  notability, a review by maintainers who owe us nothing, and a merge latency
  measured in days on every version bump. Rejected here for the same reasons
  specy's ADR-0015 rejected it.
- **Staying curl-only.** It works — that is the point of ADR-0033, and the curl
  path stays documented for anyone without brew. But it leaves "there is no
  auto-update" exactly where ADR-0033 left it, as a consequence the user
  absorbs. `brew upgrade` is the cheapest answer to it available.
- **Rendering through brew's own tooling (`brew bump-formula-pr`).** Built for
  this job, and it wants a formula already living in a tap, a PR workflow and a
  GitHub App or token with the right scopes — more machinery than three `sed`
  substitutions over a template we control.

## Consequences

- **The tap must exist, and be checked out locally.** `DATAGRAPH_TAP_DIR` points
  at that clone; `release.sh` refuses a path that is not a git checkout. The
  formula phase runs last, so if it fails the release is already published and
  the `curl | tar` install keeps working — only `brew upgrade` lags until the
  formula is pushed by hand.
- **The formula pins a versioned URL**, not the stable key. An old
  formula therefore keeps installing the version it was written for, and
  `brew upgrade` moves a user forward only when a new formula has been pushed.
- **Distribution spans three hosts.** The code is on GitLab, the artifact on
  Cloudflare R2, the tap on GitHub. Anyone tracing an install backwards crosses
  those boundaries; this ADR and ADR-0033 are where they are written down.
- **Two install paths to keep documented.** The README leads with brew and keeps
  `curl | tar` right after it, for brew-less machines and for anyone who wants
  the binary without a package manager.
- **No change to the signing stance.** brew downloads with `curl` just as the
  manual path does, so neither install sets `com.apple.quarantine` and
  ADR-0033's decision to skip Apple signing and notarization holds unchanged.
