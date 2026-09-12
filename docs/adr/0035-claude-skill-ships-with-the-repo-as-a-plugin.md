# ADR-0035 — The Claude skill ships with the repo, as a plugin

**Date**: 2026-09-12
**Status**: Accepted

## Context

`datagraph` has one non-human consumer that matters: an agent writing a config
and launching the window for a user. That consumer is driven by a Claude Code
skill — argument forms, the selector grammar, the three shaping rules, the
detached-launch protocol — and that skill lived in exactly one place:
`~/.claude/skills/datagraph/` on the maintainer's laptop. Unversioned, outside
every review, and impossible to hand to anyone.

It had already drifted. Its pre-flight section taught agents to translate every
selector into `jq` and assert a non-empty match, because when it was written
that was the only way to catch a semantically wrong config before the window
opened. ADR-0032 built `--check` precisely to replace that workaround, and the
skill kept teaching the workaround — a file documenting the binary's behaviour,
with no mechanism tying it to the binary's behaviour.

Meanwhile the binary stopped being a thing you had to build yourself:
ADR-0033 published an artifact, ADR-0034 gave it `brew install
defsquare/tap/datagraph`. The skill's install section still said "not a package
on any registry, say so rather than trying to install it".

## Decision

`skills/datagraph/` in this repository is the skill's source of truth. It is
reviewed, committed and versioned alongside the binary whose behaviour it
documents, and it goes through the same diff as a change to `cli.rs` or
`validate.ts`.

`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` make the
repository itself installable as a Claude Code plugin. The plugin root is the
repo root, so `skills/datagraph/` is picked up as the plugin's skill with no
extra declaration; the marketplace is named `defsquare` rather than `datagraph`,
and the plugin `source` is `"./"`. Because the code lives on GitLab
(ADR-0033), the install goes through the explicit URL form:

```
/plugin marketplace add https://gitlab.com/defsquare/datagraph.git
/plugin install datagraph@defsquare
```

The maintainer's `~/.claude/skills/datagraph` becomes a symlink into the
checkout — the same pattern already used for `marqueurs-llm` — so the live copy
and the reviewed copy are one file, and editing either is editing the repo.

The move is also the occasion to bring the skill back in step with the binary:
the install section now says `brew` (and names the build-from-source path for
non-arm64-macOS without offering to run it), and the pre-flight step is rebuilt
around `datagraph --check`, with `jq` demoted from validation to shape
discovery when authoring selectors against unfamiliar data.

## Alternatives considered

- **Keep the user-local copy.** Zero work, and it is exactly the arrangement
  that produced a skill teaching a workaround the binary had removed a day
  earlier. The failure is not that the file was in the wrong directory, it is
  that nothing made a CLI change look at it.
- **A separate `skills` repository.** Clean if there were several skills to
  host. There is one, and it documents this binary: splitting it off means a
  second repository to version, tag and keep in step with a release it has no
  view of. The coupling being removed here would just come back across a repo
  boundary.
- **The skill without the plugin manifests.** `skills/datagraph/` alone already
  solves versioning and review. It leaves distribution as "clone the repo and
  copy this directory into `~/.claude/skills/`" — a manual step with no update
  path, which is how the copy drifted in the first place. Two small JSON files
  buy `/plugin install`.
- **Publishing the skill to a marketplace hosted elsewhere** (a GitHub mirror,
  for the shorter `owner/repo` install form, as ADR-0034 did for the Homebrew
  tap). Rejected here: unlike `brew`, `/plugin marketplace add` takes a full
  git URL, so GitLab costs one longer line at install time and no mirror to
  keep in sync.

## Consequences

- **A behaviour change in the CLI must update the skill in the same commit.**
  Argument forms, exit codes, the config contract, the selector grammar: the
  skill is now part of the review surface, like `docs/adr/` is. That is the
  whole point of moving it, and it is a standing cost on every CLI change.
- **The plugin installs the skill, not the binary.** A plugin cannot ship a
  Mach-O; `brew` remains the install path, and the skill's own install section
  is what tells the agent to run it. An installed plugin on a machine without
  the binary is a skill whose first step fails gracefully — checked, and
  documented in the skill itself.
- **The marketplace is `defsquare`, not `datagraph`.** One namespace for the
  organisation, matching ADR-0034's `defsquare/homebrew-tap` reasoning: the
  second plugin should not need a second marketplace line.
- **The maintainer's live copy is now a symlink**, so `~/.claude/skills/` no
  longer holds a copy that can diverge — and deleting the checkout deletes the
  skill from that machine.
- **Distribution gains a fourth host relationship**, in the sense that a user
  now installs the skill from GitLab and the binary from a GitHub-hosted brew
  tap pointing at R2. The skill states this; ADR-0033 and ADR-0034 are where the
  binary half is written down.
