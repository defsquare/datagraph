---
title: The three views
linkTitle: Views
weight: 5
---

`datagraph` has three layouts of the same document. All three are built from the same graph; they differ in what they treat as a node and in what they read as a parent.

## Structure view

The default. It lays out the **containment tree** — parent and child, the document's own nesting — with ELK's `layered` algorithm, left to right, and draws the declared foreign keys as reference edges across it.

A record is a card carrying its scalar fields as rows. An object field becomes a separate card; an array field becomes an `n items` pill on the parent plus one card per element. Records declared in [`ids`](/docs/config/#ids) start collapsed; everything else opens.

What it puts on screen is bounded by construction — an opening preview of about 300 cards, expansions paginated 100 children at a time, and `tidy()` to repair the drift incremental layout leaves behind. The rules are in [Getting started](/docs/getting-started/#a-large-file-opens-on-a-preview).

**Use it to answer "what is in this document, and where".** It is the view that shows you a payload's shape, and the only one that works without a config.

## Tree view

The same cards, hung from a different parent. The tree view **reads the references backwards**: a record hangs under the target of the foreign key that claimed it, and the roots are the names in [`config.groups`](/docs/config/#groups). The nesting of the JSON plays no part — the document's tables and arrays are not drawn at all, only the records they hold.

Concretely, from `groups: ["Group"]`, an infraction that points at a group hangs under that group, a sanction that points at an infraction hangs under that infraction, and so on down the chain of references. A record that two references would claim at the same distance goes to the root declared first, exactly as in the graph view. Records nothing claims — a shared lookup table, say — sit on the top row as leaves, beside the roots, and the reference to them stays drawn as a dashed edge. A reference the tree has turned into a parent link is not drawn a second time: one stroke per link of the hierarchy.

The layout runs top to bottom, one row per level, and the view **opens fully expanded** within the same 300-card budget as the structure view; folding a node re-lays out the whole tree, so there is nothing to tidy.

**Use it on a normalised document** — flat tables joined by keys, an API's relational payload, a database export. There, the structure view shows one column per table and nothing else, because the meaning is entirely in the references; the tree view is those references read as a hierarchy. It needs `ids`, `refs` and at least one name in `groups`.

## Graph view

The third layout drops containment entirely: **records are vertices, joins are edges**. The nesting that structure view spends its space on disappears, and what is left is the relational picture — which record points at which.

Records are grouped into the DDD aggregates declared by [`config.groups`](/docs/config/#groups) and each aggregate is painted as a circular **envelope**: the minimal enclosing circle of its member cards, plus a margin. Grabbing an envelope anywhere not covered by a card moves the whole aggregate rigidly; clicking it selects the aggregate, lighting every member plus every outside card joined to one, and dimming the rest.

Zoomed far enough out, the view stops drawing cards and draws **the aggregates as the nodes**: one filled disc per aggregate, labelled with its root id and member count, with references folded into weighted edges between discs. The threshold is exactly the zoom level at which a card is already nothing but a mute rectangle, so replacing thousands of those with a few hundred named discs is a strict gain rather than a second setting to tune.

**Use it to answer "how do these records relate".** Foreign-key density, the shape of an aggregate, records that join nothing — all of it is invisible in the containment tree and obvious here.

## Switching

The toolbar carries one button per view, the active one pressed. The three views live in the same window; nothing is reloaded and no state is lost, beyond what is view-specific (an aggregate selection is a graph-view notion, so leaving the graph view drops it — a card selection carries over onto its nearest entity ancestor, and is released when the target view has no card for it, as the tree view has none for a table).

The graph view's layout engine is loaded on the first switch to it, not at startup, so a consumer that only ever uses the folded views never pays for it. The tree is built on the first switch to it as well.

Without `groups` the graph view still draws records and joins, with no envelopes to paint; the tree view has no root to hang anything from, and every record sits on its top row.

## Related

- [Config: ids, refs, groups](/docs/config/)
- [Getting started](/docs/getting-started/)
- [`docs/graph-view.md`](https://github.com/defsquare/datagraph/blob/main/docs/graph-view.md) — the graph view's layout engine, its budgets and its measurements
