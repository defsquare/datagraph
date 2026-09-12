# Rendering a schema: DB tables, UML classes, module graphs

For documents that describe a **schema** rather than instances. The target is a
class-diagram card: one box per table or class, its columns or attributes
listed inside it, its foreign keys drawn as edges between boxes.

## The mapping

| Diagram | JSON |
|---|---|
| the box | an object matched by an `ids` selector |
| a line of its compartment | a **scalar field**: key = column name, value = type |
| an association | a scalar field whose **value is the target's id**, declared in `refs` |
| a package / bounded context | a parent object holding the boxes, in `ids` + `groups` |

A foreign key is therefore neither a nested object nor an array entry: it is one
more scalar field, sitting in the compartment among the other columns — exactly
where UML puts it.

### Before / after

The natural shape, which renders badly — the columns leave the card, and every
FK becomes a node of the graph:

```json
{ "id": "advice",
  "columns": { "advice_id": "VARCHAR2(255)", "comments": "clob" },
  "fks": [{ "to": "project", "column": "project_project_id" }] }
```

The shape that renders as a class:

```json
{ "table": "advice",
  "advice_id (PK)": "VARCHAR2(255)",
  "project_project_id": "project",
  "comments": "clob" }
```

```json
{ "ids":  { "Table": "$.tables[*].table" },
  "refs": [{ "from": "$.tables[*].project_project_id",
             "to":   "$.tables[*].table" }] }
```

```
▸ Table #advice
  table                  advice
  advice_id (PK)         VARCHAR2(255)
  project_project_id     project          <- clickable, edge to Table #project
  comments               clob
```

Key order is row order: primary key first, then foreign keys, then the rest —
the UML convention, for free. Markers go in the **key**, never in the value: an
FK row's value is confiscated by the target id, so `PK` / `NOT NULL` have
nowhere else to live.

## Four collisions, invisible until the window is open

### 1. An attribute named like your id field overwrites it

You build each record as `{"table": name, **columns}`. If a column is itself
called `table`, it wins, the record's identity becomes a type string, every edge
aimed at it dangles, and the records that collapsed to the same string are
reported as duplicate ids. In a real Oracle schema, 70 tables out of 126 had a
column named `id`.

Pick an id field name **no attribute can carry**, and check it rather than
assume it — `$id` and `$table` are safe fallbacks, the selector grammar accepts
a leading `$` and SQL identifiers do not start with one.

### 2. A `refs` declaration matches a field NAME across the whole type

`{"from": "$.tables[*].requirement_id"}` applies to *every* record of that
entity type, not to the one table where that FK exists. A column sharing the
name but ordinary elsewhere — typically the target's own primary key — fires the
declaration too; its value is a type string, not an id, and the row draws a
broken-reference cross. One real schema produced 58 of them.

A declaration cannot be scoped to one record, so disarm it from the data side:
give the non-FK occurrences a key the grammar cannot match. Only
`[A-Za-z_$][\w$-]*` is matchable, so a key with a space or a parenthesis is
inert — and can say something useful while it is at it:

```json
"requirement_id (no FK)": "varchar2(255)"
```

The same trick marks primary keys: `"advice_id (PK)"` is the UML convention
*and* an unmatchable key. A column that is both PK and FK keeps the bare key —
the edge is worth more than the marker.

### 3. An id is unique per entity type, not per parent

`ids` declares a type, and the index behind it is one map per type name.
Nesting does **not** scope it: two `Package` records sitting under two different
modules that happen to share a name are one id and one card — the second is
reported as a duplicate, and the first absorbs every edge aimed at either. A
Java corpus had `com.acme.infrastructure.template` in two Maven modules.

Put whatever disambiguates them **into the id value** —
`"infra-sql/com.acme.infrastructure.template"` — rather than trusting the
nesting to keep them apart. The value is free-form; only the *field name* has to
obey the selector grammar.

### 4. The selector grammar is ASCII; identifiers in your source are not

A key is declarable only if it matches `[A-Za-z_$][\w$-]*` **read as ASCII**.
Java, C#, Python and SQL all admit accented identifiers, and one of them in a
`refs` path does not degrade into a missing edge: `parseSelector` throws, and the
user gets an error screen instead of a window.

Check it in ASCII mode rather than with your language's default `\w` — Python's
`re` is Unicode-aware unless you pass `re.A`, so `Abandonné` sails through a
naive check and detonates in the app. A key you cannot declare is not a problem
by itself: render it as an ordinary row carrying the type name, and drop only
the declaration.

## Generating it

```python
for name, t in tables.items():
    pk, fk, plain = {}, {}, {}
    for col, type_ in t["cols"]:
        target = fk_target(name, col)
        if target:           fk[col] = target                   # the edge
        elif col in t["pk"]: pk[f"{col} (PK)"] = type_          # unmatchable key
        elif col in fk_names: plain[f"{col} (no FK)"] = type_   # homonym, disarmed
        else:                plain[col] = type_
    out.append({"table": name, **pk, **fk, **plain})

config = {"ids": {"Table": "$.tables[*].table"},
          "refs": [{"from": f"$.tables[*].{f}", "to": "$.tables[*].table"}
                   for f in sorted(fk_names)]}
```

One entry per FK **column name**, not per FK: the target resolves on the row's
value, so the same column name pointing at different tables from different
records needs only one declaration.

Not every field typed by a box in the corpus is an association. The one that
bites: an **enum constant** is, in most extracted models, an attribute whose
declared type is its own enum. Taken at face value it becomes a reference from
the enum to itself, once per constant — in a 5,000-type Java corpus that was
1,400 self-edges and more than half of all `refs` declarations. Exclude a field
whose declared type is its own declaring type before you count anything.

## Readability

A card has no row cap. A 121-column table is a 2,300 px box. When the median
card exceeds ~40 rows, emit a second document with **PK and FK only** and open
that one first — same config, same edges, a tenth of the height.
