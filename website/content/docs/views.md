---
title: The two views
linkTitle: Views
weight: 5
---

`datagraph` has two layouts of the same document. Both are built from the same graph; they differ in what they treat as a node.

## Structure view

The default. It lays out the **containment tree** — parent and child, the document's own nesting — with ELK's `layered` algorithm, and draws the declared foreign keys as reference edges across it.

A record is a card carrying its scalar fields as rows. An object field becomes a separate card; an array field becomes an `n items` pill on the parent plus one card per element. Records declared in [`ids`](/docs/config/#ids) start collapsed; everything else opens.

What it puts on screen is bounded by construction — an opening preview of about 300 cards, expansions paginated 100 children at a time, and `tidy()` to repair the drift incremental layout leaves behind. The rules are in [Getting started](/docs/getting-started/#a-large-file-opens-on-a-preview).

**Use it to answer "what is in this document, and where".** It is the view that shows you a payload's shape, and the only one that works without a config.

## Graph view

The second layout drops the containment tree entirely: **records are vertices, joins are edges**. The nesting that structure view spends its space on disappears, and what is left is the relational picture — which record points at which.

Records are grouped into the DDD aggregates declared by [`config.groups`](/docs/config/#groups) and each aggregate is painted as a circular **envelope**: the minimal enclosing circle of its member cards, plus a margin. Grabbing an envelope anywhere not covered by a card moves the whole aggregate rigidly; clicking it selects the aggregate, lighting every member plus every outside card joined to one, and dimming the rest.

Zoomed far enough out, the view stops drawing cards and draws **the aggregates as the nodes**: one filled disc per aggregate, labelled with its root id and member count, with references folded into weighted edges between discs. The threshold is exactly the zoom level at which a card is already nothing but a mute rectangle, so replacing thousands of those with a few hundred named discs is a strict gain rather than a second setting to tune.

**Use it to answer "how do these records relate".** Foreign-key density, the shape of an aggregate, records that join nothing — all of it is invisible in the containment tree and obvious here.

## Switching

Both views live in the same window and the toggle is in the toolbar; nothing is reloaded and no state is lost, beyond what is view-specific (an aggregate selection is a graph-view notion, so switching to structure drops it — a card selection carries over onto its nearest entity ancestor).

The graph view's layout engine is loaded on the first switch to it, not at startup, so a consumer that only ever uses structure view never pays for it.

Without `groups` the graph view still draws records and joins; it simply has no envelopes to paint.

## Related

- [Config: ids, refs, groups](/docs/config/)
- [Getting started](/docs/getting-started/)
- [`docs/graph-view.md`](https://github.com/defsquare/datagraph/blob/main/docs/graph-view.md) — the graph view's layout engine, its budgets and its measurements
