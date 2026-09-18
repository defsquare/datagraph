# ADR-0044 — A hand-written CHANGELOG, carried by the annotated tag

**Date**: 2026-09-18
**Status**: Accepted

## Context

Three versions have shipped and none of them says what changed. `bin/release.sh`
(ADR-0033, ADR-0034) builds the binary, uploads it to R2 and pushes a formula,
and the only trace it leaves on the repository is a **lightweight** git tag —
a bare pointer, with no message. There is no GitHub release either: the bytes
live on R2, so nothing on GitHub has ever needed a body. A user upgrading
through `brew upgrade datagraph` gets new bytes and no idea what moved.

The shape of the project bounds the answer. One maintainer, and roughly fifteen
commits between two versions — mostly conventional (`feat(chrome):`,
`refactor(views):`), but written for whoever reads `git log`, not for whoever
installs the binary. "One controller per view, behind a `View` seam" is a real
commit and a non-event for a user; "a third view" is the thing they see.

## Decision

Release notes are **hand-written**, in `CHANGELOG.md` at the repository root,
in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with its
`Added` / `Changed` / `Fixed` groups, an `[Unreleased]` section at the top and
the usual comparison links at the bottom. Versions follow SemVer.

The maintainer writes the version's section **before** running the release
script — in the same pull request as the work, where it can be reviewed
alongside the diff it describes. `bin/release.sh` then does two things with it:

- `preflight` **refuses to tag** a version whose section is missing or empty,
  through the same mechanism as the dirty-tree and duplicate-tag checks (an
  error normally, a `WARNING` under `--dry-run`).
- `release` **copies the section into the tag**: the tag stops being
  lightweight and becomes annotated, its message being `datagraph <version>`,
  a blank line, then the section body verbatim.

Extraction is a four-line `awk` reading the lines between the `## [<version>]`
heading and the next `## ` heading, which is all the format needs.

## Alternatives considered

- **Generate it from the commits — `git-cliff`, `conventional-changelog`.** The
  reflex answer, and it buys nothing here. It adds a dependency and a config
  file to a repository that has one maintainer, in exchange for a list whose
  entries speak to developers: the refactors, the `chore(doc)` commits and the
  test-only ones would all need filtering, and the survivors would still be
  commit subjects. Filtering by hand what was generated to avoid writing by
  hand is a worse deal than the four entries a version actually deserves.
- **Changesets.** Made for a different problem: many packages, versioned and
  published independently, each PR dropping a fragment that a bot later
  assembles. This repository publishes a single binary, and its packages are
  private or versioned together. The per-PR file would be the whole ceremony
  with none of the payoff.
- **GitHub Releases as the source of truth.** Tempting because the tag is
  already there, and wrong in this topology: the bytes are on R2 and the tag is
  the only thing GitHub holds, so the notes would live outside the repository,
  outside its history and outside code review — editable after the fact by
  anyone with write access, and invisible to `git log`. A file in the tree is
  versioned like everything else.
- **Letting the script rename `[Unreleased]` into the new version itself.**
  Removes one manual step, and costs a commit made by the script inside a
  release that just checked the tree was clean — the preflight and the edit
  contradict each other. The maintainer renames the heading in the release PR
  instead; it is one line.

## Consequences

- **The notes are versioned and reviewable.** `CHANGELOG.md` moves in the pull
  request that causes it, so "is this user-visible, and how would you say it?"
  is a review question like any other.
- **The tag describes itself.** `git tag -n99 v0.2.0` prints the release notes
  without a network round-trip, and `git show v0.2.0` carries them too.
- **A forgotten section stops the release, loudly**, before anything is
  uploaded — the check sits in `preflight`, the first phase.
- **The maintainer decides what is user-visible.** That is the point, and it is
  also the cost: nothing enforces that a shipped change has an entry. The
  discipline is human, held by the review.
- **A GitHub release later is a one-liner.** Should the project ever want one,
  `gh release create "$TAG" --notes-from-tag` reads exactly this text — no
  second source to keep in sync.
