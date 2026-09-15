---
title: Getting started
linkTitle: Getting started
weight: 2
---

You need the binary on your `PATH`; see [Install](/docs/install/).

## Open something

```bash
datagraph                            # no argument: the built-in demo dataset
datagraph data.json                  # a document, structure view only
datagraph data.json -c config.json   # with an ids/refs/groups config
```

With no argument the binary opens the demo dataset it ships with — the fastest way to see what the canvas does before writing any config of your own.

With a document but no `-c`, nothing is declared as a record or a join, so you get the containment structure and nothing else. That is a legitimate mode for "what shape is this payload"; for anything relational, [write a config](/docs/config/).

Sample files ship with the repository:

```bash
datagraph apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json
```

`shop.json` is two customers, two orders and one order line each; `shop.config.json` is the matching `ids` / `refs` / `groups`. Small enough to read in full, large enough to show every edge kind.

Argument and file errors are reported on stderr, with a non-zero exit code, **before any window opens**: `2` for a bad argument, `1` for a file that cannot be read or parsed. A semantically invalid config is reported on the app's own error screen — or, better, by [`--check`](/docs/check/) before you open anything.

## On the canvas

| Gesture | Action |
| --- | --- |
| Two-finger swipe, or drag the background | Pan |
| Pinch, mouse wheel, <kbd>Ctrl</kbd> + wheel | Zoom at the cursor |
| Click a card | Select it |
| <kbd>Enter</kbd> on a selected card | Expand or collapse it (structure view) |
| Drag a card | Move it out of the way |
| Drag an aggregate envelope | Move the whole aggregate (graph view) |
| Arrow keys | Move the selection to the nearest visible neighbour |
| <kbd>Esc</kbd>, or click the empty background | Clear the selection |

**Selecting is how you read an edge.** Edges are drawn beneath the cards, so a reference pointing back across the layout is partly hidden at rest — deliberately, since drawing every reference over every card it crosses is noise most of the time. Selecting a card redraws its outgoing references on top, in the selection colour, and dims everything unrelated to 25 %: what stays lit is the card, the source and target of each of its references, its containment parent and its direct children. Clicking a reference follows it to its target.

**Search** runs across every field of the whole document, not just what is on screen, and walks to the next match on demand. It reveals what it needs to reach a hit and nothing more.

**The Ranger button** (the renderer's `tidy()`) re-lays out everything currently visible in one pass. Expands, collapses and page reveals are incremental — each inserts its block into the existing layout instead of recomputing it, which is what makes them instant, and also what makes the columns drift over a long session. Ranger is the repair, and it is an offered action rather than an automatic one: the layout moves under your eyes, so it should be your gesture.

Dragging is a reading gesture, not an edit. Moves are **not persisted**: the next relayout — an expand, a collapse, a view switch — recomputes positions and wipes them.

## A large file opens on a preview

Size is not a reason a document refuses to open. Three rules keep what is drawn bounded, whatever the document's size:

- **Opening is a preview.** The initial expansion walks the tree breadth-first from the root and stops at the first of two limits: the entity boundary (records declared in `ids` start collapsed) or a budget of about 300 cards. What the budget declines is still on screen, just collapsed.
- **Expansions are paginated.** Expanding a node reveals one page of 100 card children at a time. Each contiguous run still hidden is drawn in its place among the siblings as a clickable `+ n` token; clicking it reveals that run's first page.
- **Search reveals only the page holding its target.** Pages are aligned, so reaching `orders[47312]` materialises the page that holds it, with a `+ 47300` token above and a `+ 600` token below — not the 47 313 cards in front of it.

None of this touches the graph itself: `buildGraph` still builds every node, so search, references and diagnostics never see a truncated document. A document that fits under the budget opens exactly as it always did. The one hard cap left is [`maxNodes`](/docs/config/#maxnodes), a memory guard on the build and the search index.

## Related

- [Config: ids, refs, groups](/docs/config/)
- [Checking a config without opening it](/docs/check/)
- [The two views](/docs/views/)
