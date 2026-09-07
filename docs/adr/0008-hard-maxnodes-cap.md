# ADR-0008 — Hard cap of 50,000 logical nodes (`maxNodes`)

**Date**: 2026-08-30
**Status**: Superseded by [ADR-0025](./0025-structure-view-at-scale.md)

## Context

The stated budget is ~10,000 logical nodes. Beyond that nothing protected the
user: an oversized document froze the tab with no message, which is the worst
failure mode — you cannot even tell what is happening.

## Decision

A configurable `maxNodes` cap, defaulting to **50,000** logical nodes, applied by
`validateConfig` and checked when the graph is built. Exceeding it throws an
explicit `GraphTooLargeError` rather than attempting the render.

## Alternatives considered

- **No cap at all** — rejected: a frozen tab is indistinguishable from a crash.
- **Capping visible cards rather than logical nodes** — not considered at the
  time; in hindsight that is the quantity that actually cost (see below).

## Consequences

- The cap guarded **the wrong cost**. Measured on 2026-09-07: `buildGraph` is
  linear and nearly free (22 ms at 50,000 nodes), while the structure view's ELK
  layout explodes at ~n^1.7 — 16.5 s for the 16,671 cards a 50,000-node document
  makes visible, OOM around 33,000 cards. The real lever was the initial expansion
  policy, not the node count.
- The `datagraph data.json` mode without a config made the flaw obvious: with no
  entities, nothing stops the initial expansion, so the whole document entered ELK
  in a single call.
- ADR-0025 bounds the opening with a card budget and gives `maxNodes` its real
  role — a **memory** guard on `buildGraph` + index, both linear — with the default
  raised to 1,000,000.
