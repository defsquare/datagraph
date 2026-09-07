# ADR-0022 — Data-first `ids` / `refs` / `groups` contract

**Date**: 2026-09-04
**Status**: Accepted

## Context

The public config spoke DDD: `entities`, `references`, `aggregates` (ADR-0004).
But the tool does not visualise a domain model — it visualises data joined by
keys. The vocabulary asked the reader to buy into a design method just to declare
that `orders[*].customerId` points at `customers[*].id`. The CLI (ADR-0021) made
the mismatch visible: the end user writes a `-c` file, not a model.

## Decision

A data-centred contract:

```json
{
  "ids":    { "Customer": "$.customers[*].id" },
  "refs":   [ { "from": "$.orders[*].customerId", "to": "$.customers[*].id" } ],
  "groups": ["Customer"],
  "maxNodes": 1000000,
  "rootLabel": "$"
}
```

- **`ids`**: name → key path. The prefix designates the instance set, the last
  segment the key field. The name is a **presentation handle** (labels, colours,
  badges), not a domain concept.
- **`refs`**: a **list** of `{from, to}` joins — not an object, so two references
  leaving the same path do not collide.
- **`groups`**: optional, the names anchoring graph-view grouping, in tie-breaking
  order (ADR-0015). Absent → a flat graph view.

**A 0.x break with no compatibility layer**: every existing `-c` file must
migrate. The precedent was set by `graphLayoutOptions` (ADR-0017).

Two days later a naming refactor settled the internal vocabulary: a
*group / aggregate / cluster / envelope* glossary in the core README, and
**`validateConfig` documented as the single translation boundary** from
`ids/refs/groups` to `entities/references/aggregates`.

## Alternatives considered

- **A compatibility layer accepting both shapes** — rejected: the project is 0.x,
  and two coexisting public vocabularies would have perpetuated exactly the
  confusion being removed.
- **A free `to` targeting a field other than the declared key** — out of scope.
  `refs[].to` must be exactly one of the `ids` paths, compared as **parsed
  segments** rather than raw strings; the door stays open without being paid for
  now.
- **Automatic group inference** — rejected: grouping is an intent, not a derivable
  property.

## Consequences

- The core downstream of `ValidatedConfig` **did not move**: `build.ts`,
  `aggregate.ts`, layout, renderer, labels and colours are intact bar one line.
  That is the deferred payoff of ADR-0004's seam.
- **Accepted, documented regression**: with an absolute `from`, the whole path goes
  through the selector grammar, whose token only accepts `[A-Za-z_$][\w$-]*`. An
  exotic key such as `@odata:id`, accepted verbatim by the old contract, can no
  longer be declared.
- The `unknown-entity-type` error code becomes `unknown-group`, and the npm
  keywords `ddd` / `aggregate` / `entity` give way to `data-first` /
  `foreign-keys` / `reference-edges`.
- Purging the vocabulary had to be finished by hand in the `--help` text and the
  READMEs, where "entity graph" and "DDD aggregates" had survived.
