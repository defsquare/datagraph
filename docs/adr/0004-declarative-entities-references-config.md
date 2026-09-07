# ADR-0004 — Declarative `entities` / `references` config (DDD vocabulary)

**Date**: 2026-08-30
**Status**: Superseded by [ADR-0022](./0022-data-first-ids-refs-groups-contract.md)

## Context

Nothing in a JSON document says that a `customerId` points at a customer: the
library needs to be told. So it needs an input contract, and the project is framed
from the start as exploring "complex objects — entities and aggregates in the DDD
sense".

## Decision

A declarative config, in the vocabulary of the domain:

```ts
{
  entities:   { Customer: { match: "$.customers[*]", id: "id" } },
  references: { Order: { customerId: "Customer" } },
  aggregates: ["Customer"],       // added with the graph view
  maxNodes, rootLabel
}
```

`match` is a small subset of JSONPath (literal segments, `[*]`, `.*`), not the full
standard. `validateConfig` parses the selectors and returns a `ValidatedConfig`
backed by `Map`s — the only shape the rest of the core consumes.

## Alternatives considered

- **Full JSONPath** — rejected: the specification's surface is far wider than
  anything `match` needs to express.
- **Automatic inference of entities and references** — rejected then and still out
  of scope: grouping across references is an intent, not a property derivable from
  the data.

## Consequences

- The "public config → internal `ValidatedConfig`" seam made replacing the
  vocabulary almost painless: it is what allowed ADR-0022 to rewrite everything
  upstream without touching `build.ts`, `aggregate.ts`, layout or renderer.
- The DDD vocabulary (`entity`, `aggregate`) ended up describing the tool badly —
  it visualises joined data, not a domain model — hence the break recorded in
  ADR-0022. The internal names downstream of `validateConfig` survived, with
  `validateConfig` becoming the single translation boundary.
