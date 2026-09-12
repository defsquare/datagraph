// GENERATED FILE — do not edit.
// Run `pnpm --filter @defsquare/data-graph-core generate:check` after any change to
// the validation closure (validate.ts, build.ts, config.ts, selector.ts, model.ts).
// Embedded verbatim in the datagraph binary by `include_str!`, see
// apps/demo/src-tauri/src/check.rs. Freshness: packages/core/test/check-bundle.test.ts.
"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/selector.ts
  var ConfigError = class extends Error {
    constructor(code, message) {
      super(message);
      __publicField(this, "code", code);
      this.name = "ConfigError";
    }
  };
  var TOKEN = /^(?:\.(\*|[A-Za-z_$][\w$-]*)|\[(\*|\d+)\])/;
  function parseSelector(selector) {
    if (!selector.startsWith("$")) {
      throw new ConfigError("selector-syntax", `Selector must start with "$": ${selector}`);
    }
    let rest = selector.slice(1);
    const segments = [];
    while (rest.length > 0) {
      const m = TOKEN.exec(rest);
      if (!m) throw new ConfigError("selector-syntax", `Invalid selector near "${rest}" in ${selector}`);
      if (m[1] !== void 0) {
        segments.push(m[1] === "*" ? { kind: "wildcard" } : { kind: "key", key: m[1] });
      } else {
        segments.push(m[2] === "*" ? { kind: "wildcard" } : { kind: "index", index: Number(m[2]) });
      }
      rest = rest.slice(m[0].length);
    }
    if (segments.length === 0) throw new ConfigError("selector-syntax", `Empty selector: ${selector}`);
    return segments;
  }
  function matchesPath(segments, path) {
    if (segments.length !== path.length) return false;
    return segments.every((seg, i) => {
      const part = path[i];
      if (seg.kind === "wildcard") return true;
      if (seg.kind === "key") return part === seg.key;
      return part === seg.index;
    });
  }

  // src/config.ts
  function segmentsEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((seg, i) => {
      const other = b[i];
      if (seg.kind !== other.kind) return false;
      if (seg.kind === "key" && other.kind === "key") return seg.key === other.key;
      if (seg.kind === "index" && other.kind === "index") return seg.index === other.index;
      return true;
    });
  }
  function validateConfig(config) {
    if (config === null || typeof config.ids !== "object" || config.ids === null || Array.isArray(config.ids)) {
      throw new ConfigError("invalid-config", "Config must declare an ids object");
    }
    const entities = /* @__PURE__ */ new Map();
    const idPathSegments = /* @__PURE__ */ new Map();
    for (const [name, idPath] of Object.entries(config.ids)) {
      if (typeof idPath !== "string") {
        throw new ConfigError("invalid-config", `Id path for '${name}' must be a string selector`);
      }
      const segments = parseSelector(idPath);
      const last = segments[segments.length - 1];
      if (last.kind !== "key") {
        throw new ConfigError(
          "invalid-config",
          `Id path for '${name}' must end on a field name: ${idPath}`
        );
      }
      entities.set(name, { segments: segments.slice(0, -1), idField: last.key });
      idPathSegments.set(name, segments);
    }
    const references = /* @__PURE__ */ new Map();
    if (config.refs !== void 0 && !Array.isArray(config.refs)) {
      throw new ConfigError("invalid-config", "Config 'refs' must be an array of {from, to} entries");
    }
    for (const ref of config.refs ?? []) {
      if (typeof ref !== "object" || ref === null || typeof ref.from !== "string" || typeof ref.to !== "string") {
        throw new ConfigError("invalid-config", "Each ref must declare string 'from' and 'to' paths");
      }
      const toSegments = parseSelector(ref.to);
      let targetType;
      for (const [name, segs] of idPathSegments) {
        if (segmentsEqual(segs, toSegments)) {
          targetType = name;
          break;
        }
      }
      if (targetType === void 0) {
        throw new ConfigError("invalid-config", `Ref target must be a declared id path: ${ref.to}`);
      }
      const fromSegments = parseSelector(ref.from);
      let owner;
      let ownerLen = -1;
      for (const [name, entity] of entities) {
        const prefix = entity.segments;
        if (prefix.length < fromSegments.length && prefix.length > ownerLen && segmentsEqual(prefix, fromSegments.slice(0, prefix.length))) {
          owner = name;
          ownerLen = prefix.length;
        }
      }
      if (owner === void 0) {
        throw new ConfigError(
          "invalid-config",
          `Ref source must extend a declared instance prefix: ${ref.from}`
        );
      }
      const remainder = fromSegments.slice(ownerLen);
      const last = remainder[remainder.length - 1];
      if (last.kind !== "key") {
        throw new ConfigError(
          "invalid-config",
          `Ref source must end on a field name: ${ref.from}`
        );
      }
      const decl = {
        navigate: remainder.slice(0, -1),
        field: last.key,
        targetType,
        path: ref.from
      };
      const list = references.get(owner);
      if (list) list.push(decl);
      else references.set(owner, [decl]);
    }
    const aggregates = [];
    if (config.groups !== void 0 && !Array.isArray(config.groups)) {
      throw new ConfigError("invalid-config", "Config 'groups' must be an array of ids names");
    }
    for (const name of config.groups ?? []) {
      if (!entities.has(name)) {
        throw new ConfigError("unknown-group", `Unknown group: '${name}' is not declared in ids`);
      }
      aggregates.push(name);
    }
    const maxNodes = config.maxNodes ?? 1e6;
    const rootLabel = config.rootLabel ?? "$";
    return { entities, references, maxNodes, rootLabel, aggregates };
  }

  // src/model.ts
  var VALUE_ONLY_KEY = "$value";
  var GraphTooLargeError = class extends Error {
    constructor(count, max) {
      super(`Graph exceeds maxNodes: ${count} > ${max} — raise "maxNodes" in the config (the CLI's -c option)`);
      __publicField(this, "count", count);
      __publicField(this, "max", max);
      this.name = "GraphTooLargeError";
    }
  };

  // src/build.ts
  function escapePointerSegment(key) {
    return key.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  function pointerOf(path) {
    if (path.length === 0) return "/";
    return "/" + path.map((seg) => escapePointerSegment(String(seg))).join("/");
  }
  function isScalar(value) {
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
  function scalarValueType(value) {
    if (value === null) return "null";
    return typeof value;
  }
  function labelFor(path, parentNode) {
    const key = path[path.length - 1];
    return parentNode && parentNode.kind === "array" ? `${parentNode.label}[${key}]` : String(key);
  }
  function buildGraph(data, config) {
    const validated = validateConfig(config);
    const graph = {
      nodes: /* @__PURE__ */ new Map(),
      rootId: "/",
      containEdges: [],
      refEdges: [],
      entityIndex: /* @__PURE__ */ new Map(),
      diagnostics: [],
      logicalNodeCount: 0
    };
    function countLogical(n) {
      graph.logicalNodeCount += n;
      if (graph.logicalNodeCount > validated.maxNodes) {
        throw new GraphTooLargeError(graph.logicalNodeCount, validated.maxNodes);
      }
    }
    function findEntityMatch(path) {
      for (const [entityType, entity] of validated.entities) {
        if (matchesPath(entity.segments, path)) {
          return { entityType, idField: entity.idField };
        }
      }
      return null;
    }
    function visitValue(value, path, parentId, parentNode, parentDrawn) {
      const id = pointerOf(path);
      if (isScalar(value)) {
        const scalarNode = {
          kind: "object",
          id,
          path: [...path],
          label: path.length === 0 ? validated.rootLabel : labelFor(path, parentNode),
          rows: [{ key: VALUE_ONLY_KEY, value, valueType: scalarValueType(value) }],
          parentId,
          childIds: [],
          elided: false,
          cardChildCount: 0
        };
        graph.nodes.set(id, scalarNode);
        countLogical(1);
        linkChild(parentNode, scalarNode);
        return id;
      }
      const isArray = Array.isArray(value);
      const entityMatch = !isArray ? findEntityMatch(path) : null;
      const elided = isArray && parentDrawn;
      const drawn = !elided;
      let label = path.length === 0 ? validated.rootLabel : labelFor(path, parentNode);
      let entityType;
      let entityId;
      if (entityMatch) {
        const rawId = value[entityMatch.idField];
        if (rawId === void 0) {
          graph.diagnostics.push({
            code: "missing-id",
            path: id,
            message: `Entity "${entityMatch.entityType}" at ${id} is missing id field "${entityMatch.idField}"`
          });
        } else {
          entityType = entityMatch.entityType;
          entityId = String(rawId);
        }
      }
      let node;
      if (entityType !== void 0 && entityId !== void 0) {
        label = `${entityType} #${entityId}`;
        const entityNode = {
          kind: "entity",
          id,
          path: [...path],
          label,
          rows: [],
          parentId,
          childIds: [],
          entityType,
          entityId,
          elided,
          cardChildCount: 0
        };
        node = entityNode;
      } else if (isArray) {
        const arrayNode = {
          kind: "array",
          id,
          path: [...path],
          label,
          rows: [],
          parentId,
          childIds: [],
          length: value.length,
          elided,
          cardChildCount: 0
        };
        node = arrayNode;
      } else {
        const objectNode = {
          kind: "object",
          id,
          path: [...path],
          label,
          rows: [],
          parentId,
          childIds: [],
          elided,
          cardChildCount: 0
        };
        node = objectNode;
      }
      graph.nodes.set(id, node);
      countLogical(1);
      linkChild(parentNode, node);
      if (node.kind === "entity") {
        let byType = graph.entityIndex.get(node.entityType);
        if (!byType) {
          byType = /* @__PURE__ */ new Map();
          graph.entityIndex.set(node.entityType, byType);
        }
        if (byType.has(node.entityId)) {
          graph.diagnostics.push({
            code: "duplicate-id",
            path: id,
            message: `Duplicate entity id "${node.entityId}" for type "${node.entityType}" at ${id}`
          });
        } else {
          byType.set(node.entityId, id);
        }
      }
      if (isArray) {
        ;
        value.forEach((item, index) => {
          const childId = visitValue(item, [...path, index], id, node, drawn);
          addArrayRowIfElided(node, String(index), item, childId, drawn);
        });
      } else {
        for (const [key, val] of Object.entries(value)) {
          if (isScalar(val)) {
            node.rows.push({ key, value: val, valueType: scalarValueType(val) });
            countLogical(1);
          } else if (val !== void 0) {
            const childId = visitValue(val, [...path, key], id, node, drawn);
            addArrayRowIfElided(node, key, val, childId, drawn);
          }
        }
      }
      return id;
    }
    function linkChild(parent, child) {
      if (!parent) return;
      graph.containEdges.push({ kind: "contain", from: parent.id, to: child.id });
      parent.childIds.push(child.id);
      if (!child.elided) parent.cardChildCount++;
    }
    function addArrayRowIfElided(node, key, value, childId, parentDrawn) {
      if (!parentDrawn || !Array.isArray(value)) return;
      node.rows.push({
        key,
        value: value.length,
        valueType: "array",
        arrayId: childId
      });
    }
    visitValue(data, [], null, null, false);
    function navigateFrom(start, navigate) {
      let current = [start];
      for (const segment of navigate) {
        const next = [];
        for (const node of current) {
          for (const childId of node.childIds) {
            const child = graph.nodes.get(childId);
            if (!child) continue;
            if (matchesPath([segment], child.path.slice(-1))) next.push(child);
          }
        }
        if (next.length === 0) return [];
        current = next;
      }
      return current;
    }
    const unsatisfied = /* @__PURE__ */ new Set();
    const typesSeen = /* @__PURE__ */ new Set();
    for (const decls of validated.references.values()) for (const d of decls) unsatisfied.add(d);
    for (const node of graph.nodes.values()) {
      if (node.kind !== "entity") continue;
      typesSeen.add(node.entityType);
      const decls = validated.references.get(node.entityType);
      if (!decls) continue;
      for (const decl of decls) {
        for (const holder of navigateFrom(node, decl.navigate)) {
          const row = holder.rows.find((r) => r.key === decl.field);
          if (!row) continue;
          unsatisfied.delete(decl);
          if (row.valueType === "array" || row.value === null) continue;
          const targetId = String(row.value);
          const to = graph.entityIndex.get(decl.targetType)?.get(targetId) ?? null;
          const dangling = to === null;
          graph.refEdges.push({
            kind: "ref",
            from: holder.id,
            fromEntity: node.id,
            to,
            field: decl.field,
            targetType: decl.targetType,
            targetId,
            dangling
          });
          if (dangling) {
            graph.diagnostics.push({
              code: "dangling-ref",
              path: holder.id,
              message: `Reference "${decl.field}" on ${node.entityType} at ${holder.id} targets unknown ${decl.targetType} "${targetId}"`
            });
          }
        }
      }
    }
    for (const [sourceType, decls] of validated.references) {
      if (!typesSeen.has(sourceType)) continue;
      for (const decl of decls) {
        if (!unsatisfied.has(decl)) continue;
        graph.diagnostics.push({
          code: "unresolved-reference",
          // `decl.path` is now the absolute `from`: prefixing it with the type
          // would produce "Order.$.orders[*]…".
          path: decl.path,
          message: `Reference "${decl.path}" declared on ${sourceType} matches no row on any ${sourceType}`
        });
      }
    }
    return graph;
  }

  // src/validate.ts
  function runCheck(dataText, configText, asJson) {
    const report = checkReport(JSON.parse(dataText), JSON.parse(configText));
    const output = asJson ? `${JSON.stringify(report, null, 2)}
` : renderText(report);
    return `${report.ok ? 0 : 3}
${output}`;
  }
  var MAX_LISTED_DIAGNOSTICS = 20;
  function pad(text, width) {
    return text + " ".repeat(Math.max(0, width - [...text].length));
  }
  function renderText(report) {
    let out = report.ok ? `✓ config valid — ${report.totals.entities} entities, ${report.refs.reduce((sum, entry) => sum + entry.resolved, 0)} references resolved
` : "✗ config invalid\n";
    out += "\n";
    const mark = out.length;
    if (report.configErrors.length > 0) {
      out += "  errors\n";
      for (const error of report.configErrors) out += `    ${error.code}  ${error.message}
`;
    }
    const ids = Object.entries(report.ids).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (ids.length > 0) {
      out += "  ids\n";
      const nameWidth = Math.max(...ids.map(([name]) => [...name].length));
      const selectorWidth = Math.max(...ids.map(([, entry]) => [...entry.selector].length));
      for (const [name, entry] of ids) {
        const warning = entry.pathResolves ? "" : "  (path does not resolve)";
        const unit = entry.matched === 1 ? "instance" : "instances";
        out += `    ${pad(name, nameWidth)}  ${pad(entry.selector, selectorWidth)}  ${entry.matched} ${unit}${warning}
`;
      }
    }
    if (report.refs.length > 0) {
      out += "  refs\n";
      for (const entry of report.refs) {
        const dangling = entry.dangling > 0 ? `, ${entry.dangling}/${entry.matched} dangling` : "";
        out += `    ${entry.from} → ${entry.to}    ${entry.resolved}/${entry.matched} resolved${dangling}
`;
      }
    }
    if (out.length > mark) out += "\n";
    if (report.diagnostics.length === 0) {
      out += "  No diagnostics.\n";
    } else {
      out += `  diagnostics (${report.diagnostics.length})
`;
      for (const entry of report.diagnostics.slice(0, MAX_LISTED_DIAGNOSTICS)) {
        out += `    ${entry.code}  ${entry.message}
`;
      }
      if (report.diagnostics.length > MAX_LISTED_DIAGNOSTICS) {
        const rest = report.diagnostics.length - MAX_LISTED_DIAGNOSTICS;
        out += `    … and ${rest} more — use --json for the full list
`;
      }
    }
    return out;
  }
  function checkReport(data, config) {
    const typed = config;
    let graph;
    try {
      graph = buildGraph(data, typed);
    } catch (error) {
      if (error instanceof ConfigError) return failed(error.code, error.message);
      if (error instanceof GraphTooLargeError) {
        return failed("graph-too-large", error.message, error.count);
      }
      throw error;
    }
    const ids = analyzeIds(data, typed, graph);
    const refs = analyzeRefs(typed, graph);
    const diagnostics = graph.diagnostics;
    let entities = 0;
    for (const byId of graph.entityIndex.values()) entities += byId.size;
    const ok = Object.values(ids).every((entry) => entry.pathResolves) && !diagnostics.some((d) => d.code === "unresolved-reference");
    return {
      report: 1,
      ok,
      configErrors: [],
      ids,
      refs,
      diagnostics,
      // Three different units — see the `totals` field doc.
      totals: {
        nodes: graph.nodes.size,
        logicalNodes: graph.logicalNodeCount,
        entities,
        refEdges: graph.refEdges.length
      }
    };
  }
  function failed(code, message, logicalNodes = 0) {
    return {
      report: 1,
      ok: false,
      configErrors: [{ code, message }],
      ids: {},
      refs: [],
      diagnostics: [],
      totals: { nodes: 0, logicalNodes, entities: 0, refEdges: 0 }
    };
  }
  function analyzeIds(data, config, graph) {
    const ids = {};
    for (const [name, selector] of Object.entries(config.ids)) {
      const segments = parseSelector(selector);
      const prefix = segments.slice(0, -1);
      let matched = 0;
      for (const node of graph.nodes.values()) if (matchesPath(prefix, node.path)) matched++;
      ids[name] = { selector, matched, pathResolves: resolves(data, prefix) };
    }
    return ids;
  }
  function analyzeRefs(config, graph) {
    return (config.refs ?? []).map((ref) => {
      const fromSegments = parseSelector(ref.from);
      let matched = 0;
      let resolved = 0;
      let dangling = 0;
      for (const edge of graph.refEdges) {
        const holder = graph.nodes.get(edge.from);
        if (!holder) continue;
        if (!matchesPath(fromSegments, [...holder.path, edge.field])) continue;
        matched++;
        if (edge.dangling) dangling++;
        else resolved++;
      }
      return { from: ref.from, to: ref.to, matched, resolved, dangling };
    });
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function resolves(data, segments) {
    let current = [data];
    for (const segment of segments) {
      if (segment.kind === "key") {
        const key = segment.key;
        const next = current.filter(isRecord).filter((v) => key in v).map((v) => v[key]);
        if (next.length === 0) return false;
        current = next;
      } else if (segment.kind === "index") {
        const index = segment.index;
        const next = current.filter((v) => Array.isArray(v)).map((a) => a[index]).filter((v) => v !== void 0);
        if (next.length === 0) return false;
        current = next;
      } else {
        const containers = current.filter((v) => Array.isArray(v) || isRecord(v));
        if (containers.length === 0) return false;
        current = containers.flatMap(
          (v) => Array.isArray(v) ? v : Object.values(v)
        );
        if (current.length === 0) return true;
      }
    }
    return true;
  }

  // scripts/check-entry.ts
  globalThis.__datagraph_check = runCheck;
})();
