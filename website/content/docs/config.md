---
title: "Config: ids, refs, groups"
linkTitle: Config
weight: 3
---

The config is what turns a JSON tree into a graph. It is plain JSON, passed with `-c`:

```bash
datagraph data.json -c config.json
```

Without it the app opens in structure view only: the raw nesting, no records, no edges.

## The whole thing

```json
{
  "ids": {
    "Customer": "$.customers[*].id",
    "Order": "$.orders[*].id"
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id" }
  ],
  "groups": ["Customer"],
  "maxNodes": 1000000,
  "rootLabel": "$"
}
```

## `ids`

Maps a name to a selector that ends in the field holding the id, e.g. `"$.customers[*].id"`. Any object matched by that selector **minus its last segment** becomes an *entity* node instead of a plain object node.

Entities are the only nodes that start collapsed, and the only sources and targets of reference edges. The name is presentation only — labels, colours, badges.

`ids` is required for anything relational.

## `refs`

An array of joins, `{ from, to }`.

- `from` selects a field whose value is meant to be read as a foreign key.
- `to` must be **one of the selectors declared verbatim in `ids`**.

`datagraph` resolves each `from` value against the target's index at build time and draws a reference edge, highlighted differently when the target id does not exist. An unmatched target draws as a dangling edge rather than failing the build.

## `groups`

Names from `ids` that are DDD aggregate roots, **in declaration order**. They drive the [graph view](/docs/views/#graph-view): each aggregate is painted as a circular envelope around its members.

An entity `E` belongs to the aggregate rooted at `R` when `R` is the winner among the roots at the minimal distance from `E`, where distance is the number of outgoing references leading from `E` to a root. A root is at distance `0` from itself, so it always wins its own aggregate.

**The declaration order is load-bearing.** It is what breaks a distance tie — a record equidistant from two roots is claimed by whichever root's name comes first — and it fixes the paint order of the envelopes. Put the dominant root first. Membership is a strict partition: every entity that reaches at least one root belongs to exactly one aggregate, never two.

## `maxNodes`

Optional safety cap, default `1000000`. Past it, `buildGraph` throws `GraphTooLargeError`, and the message names the way out: raise `maxNodes` in the `-c` config.

It guards the **memory** of the built graph and its search index, not layout cost — the views bound what they lay out themselves (see [the preview rules](/docs/getting-started/#a-large-file-opens-on-a-preview)). The default is where the core package's benchmark put it, about 3× under the memory budget. The count it bounds is the graph nodes plus the scalar rows, which [`--check --json`](/docs/check/#--json) reports as `totals.logicalNodes`.

## `rootLabel`

Label shown on the root node, default `"$"` — the root symbol of the same selector syntax `ids` uses. Set it to something your users recognise (`"Shop"`, `"Invoice"`) when the graph is customer-facing. An empty string is honoured rather than falling back to the default.

## Selector grammar

Narrower than JSONPath. A selector must start with `$`, then only these tokens:

| Token | Meaning |
| --- | --- |
| `.key` | object key, matching `[A-Za-z_$][\w$-]*` |
| `.*` | any key at this level |
| `[3]` | array index |
| `[*]` | any array index |

There is **no** `..` recursive descent, no filters `[?(...)]`, and no quoted keys.

{{< callout type="warning" >}}
**Limitation.** A field key that does not match the token grammar — `@odata:id`, `user name` — cannot be expressed, and therefore cannot be declared as an id or a reference field. There is no escape syntax; the only fix is to rename the key in the document.
{{< /callout >}}

When you are writing a config against data whose shape you do not know, dump the real paths first and write selectors from them:

```bash
jq 'paths(scalars) | @json' data.json | sort -u | head -50
```

## Shape decides what a card shows

The config declares records and joins; it is the **document's shape** that decides what a card reads like. `buildGraph` has exactly three rules:

| In the JSON | On screen |
| --- | --- |
| scalar field of an object | a `key: value` **row** on the card |
| object field | a **separate card**, and no row at all on the parent |
| array field | an `n items` pill on the parent, then one card per element |

So whatever you want to read inside a card must be a direct scalar field of that object. This only matters when you are the one producing the document — an export, an audit, a transformation. For a file somebody else owns, the shape is theirs.

## Related

- [Checking a config without opening it](/docs/check/)
- [The two views](/docs/views/)
- [Getting started](/docs/getting-started/)
