# ADR-0033 — An unsigned arm64 macOS binary, hosted on Cloudflare R2

**Date**: 2026-09-12
**Status**: Accepted

## Context

For standalone use the binary *is* the product: ADR-0021 made the `datagraph`
CLI the Tauri binary itself, so there is nothing else to ship. Yet the only way
to obtain it was to clone the repository, install pnpm, install a Rust
toolchain and wait out a `tauri build` — a reasonable ask of a contributor, an
absurd one of someone who wants to look at a JSON file. What the project needs
is a download URL.

Two constraints shape how that URL comes to exist.

The first is Gatekeeper. Handing out a macOS executable normally means an Apple
Developer account (paid, renewed yearly), a signing identity held somewhere
safe, and a notarization round-trip on every release — infrastructure out of
proportion to a tool distributed to a handful of users.

The second is where the code lives. The repository stays on GitLab, as
`gitlab.com/defsquare/datagraph`, and **GitLab's hosted macOS runners are a
Premium/Ultimate feature**. There is no free CI machine that can run
`tauri build` for this target. That is the same wall specy hit (its ADR-0015),
and it settled the question the same way: the release is a script the
maintainer runs.

## Decision

`bin/release.sh <version>`, run locally on a Mac, is the release process. It
builds with a plain `tauri build` for the host, so the artifact is a **native
arm64 binary**, packages it as
`datagraph-<version>-darwin-arm64.tar.gz` — tar rather than zip, because it
preserves the executable bit — and uploads it to a **public Cloudflare R2
bucket** served behind a custom domain. That is the hosting specy's ADR-0015
already chose, so the organisation runs one distribution scheme rather than two.

The upload goes through **Wrangler**, Cloudflare's CLI, invoked with `npx` so
nothing is installed globally, and authenticated by the operator's own
`wrangler login` OAuth session. No R2 credential exists in the environment, in
`bin/release.env`, or anywhere in the repository.

Each release writes the same bytes under **two keys**:

- the **versioned** key, `datagraph/datagraph-<version>-darwin-arm64.tar.gz`,
  which the Homebrew formula pins (ADR-0034) so an old formula keeps installing
  the version it was written for;
- the **stable** key, `datagraph/datagraph-darwin-arm64.tar.gz`, which is what the
  README's copy-paste install line fetches and which therefore always serves the
  most recent release.

```bash
curl -fsSL https://dl.datagraph.defsquare.com/datagraph/datagraph-darwin-arm64.tar.gz | tar -xz
```

The version is also recorded as a git tag `vX.Y.Z`, pushed by the script — the
hosting does not need it, but the history does.

**The binary is signed ad hoc, not by Apple** — and nothing in the script has to
do it. macOS will not execute an arm64 binary whose signature is broken, but the
linker ad-hoc signs a native arm64 build as it produces it, and no `lipo` step
comes afterwards to invalidate that signature. specy's ADR-0015 records the same
fact; a `codesign --force -s -` pass would only re-apply what is already there.

**Apple signing and notarization are avoided rather than deferred**, because
the install path never puts them in play: `curl` sets no `com.apple.quarantine`
attribute on the file it writes, and Gatekeeper only assesses quarantined
files. The escape hatch for the one case that *is* quarantined — a download
made with a browser — is documented in the README: `xattr -d
com.apple.quarantine ./datagraph`.

The script follows specy's shape down to the details, because that shape has
already been run in anger: version-regex validation, an auto-sourced
git-ignored `bin/release.env` documented by a tracked `bin/release.env.example`,
a `require_env` guard, a `--dry-run` that prints the plan and the rendered
formula without touching the network, and the artifact published *before* the
formula that points at it.

## Alternatives considered

- **GitLab's generic package registry + a GitLab release asset permalink.** The
  first draft of this very ADR, and tempting because the code is already on
  GitLab: the release's asset `filepath` yields a version-independent permalink
  to the latest release that never changes. Rejected on two counts. Anonymous download requires the GitLab
  project to be **public**, which couples how the binary is distributed to how
  the repository is visible — two decisions that should move independently. And
  it needs a personal access token with `api` scope, held on the maintainer's
  machine and in the release env, where the Wrangler OAuth session the
  organisation already maintains costs nothing extra.
- **Signing and notarizing properly.** The right answer for a product with a
  download page and non-technical users. Here it buys nothing the curl install
  does not already have, and costs a paid account, a secret to hold and a
  notarization step that can fail on Apple's side at release time. Revisit if
  the audience ever arrives through a browser.
- **GitHub Actions on a GitHub mirror.** Free `macos-latest` runners would make
  the release a `git push --tags` and nothing else. It costs a second home for
  the code — a mirror to keep in sync, two issue trackers, two URLs in every
  README — and the project wants one home, which is GitLab. Reconsider if the
  release ever becomes frequent enough that running it by hand hurts.
- **A self-hosted GitLab runner on the developer Mac.** Turns the tag push into
  a build without paying GitLab or moving to GitHub. But the machine doing the
  work is the same laptop either way; the runner only adds a daemon to keep
  registered, updated and awake. Standing infrastructure for a solo project, in
  exchange for a script it would run anyway.
- **Paying for Premium to get hosted macOS runners.** A per-seat subscription
  to automate one command, on a project whose release cadence is measured in
  weeks. The arithmetic argues for itself.
- **Uploading through R2's S3-compatible API.** Works, with an R2 "S3" token —
  but that means installing an S3 client and minting an access-key/secret pair
  to keep somewhere. Wrangler is Cloudflare-native, needs no install via `npx`,
  and reuses the OAuth login already in place.
- **A universal binary, built with `--target universal-apple-darwin`.** It gives
  Intel users a prebuilt path for the cost of one `rustup target add`. It also
  doubles compile time on every release, adds the `lipo` fuse and the ad-hoc
  re-sign it makes necessary, and spends all of that on an audience — Intel
  Macs, shrinking since 2020 — that build-from-source already covers. The first
  release attempt failed on exactly that missing `x86_64-apple-darwin`
  toolchain, which is what settled the question. Revisit if an Intel user
  actually asks.
- **Shipping the binary inside an npm package.** The repo already publishes JS
  packages, so the channel exists. But this artifact opens a desktop window;
  putting it behind `npm i -g` would tie a GUI tool to a Node install it does
  not otherwise need, and npm's postinstall-download pattern is exactly the
  fragile machinery the curl line replaces.

## Consequences

- **Releasing requires a maintainer's Mac** and a configured `bin/release.env`
  (bucket, download base URL, tap checkout) plus a live `wrangler login`.
  Nobody can cut a release from a browser, and CI cannot cut one at all. That is
  the cost of the constraint, not an oversight.
- **The R2 object and the formula must stay in sync.** The script uploads first
  and pushes the formula last, the same discipline specy's ADR-0015 set, so a
  published formula never points at a key that does not exist.
- **The stable-key URL is load-bearing.** `datagraph/datagraph-darwin-arm64.tar.gz` is
  the URL printed in the README and pasted into terminals; renaming it breaks
  the documented install. It changes only with a deliberate migration.
- **Nothing hosting-specific is committed.** The bucket and the download domain
  are deployment parameters living only in the operator's env file
  (`DATAGRAPH_R2_BUCKET`, `DATAGRAPH_DL_BASE_URL`), documented by the tracked
  `bin/release.env.example`.
- **The tag is created by the script, from a clean committed tree.** A dirty
  working tree or an existing `vX.Y.Z` aborts before the build starts, so a
  published binary always corresponds to a commit that exists in the remote.
- **Releases exist for macOS on Apple silicon only.** The formula declares
  `depends_on arch: :arm64`, so `brew install` refuses cleanly on an Intel Mac
  instead of installing a binary that cannot run, and the README says arm64-only
  and routes Intel users to the build-from-source fallback. Linux and Windows
  stay build-from-source too, rather than implying a download that isn't there.
- **A browser download still hits Gatekeeper.** The `xattr -d` step is then
  mandatory, and it is documentation — nothing in the artifact can make it
  unnecessary short of notarization.
- **There is no auto-update.** The binary does not phone home and will not
  learn to; a user upgrades with `brew upgrade` (ADR-0034) or by running the
  curl command again.
