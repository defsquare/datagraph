//! The `--check` report, Rust side: the wire shape, the exit-code rule and the
//! text rendering.
//!
//! NO engine here. Keeping this module pure is what lets the exit codes and the
//! whole rendering be unit-tested without compiling QuickJS, and it is the line
//! the test plan draws: SEMANTICS are tested in TypeScript, the BOUNDARY is
//! tested in Rust. Duplicating the semantic corpus on this side would recreate
//! the two-language tax that refusing the Rust port avoided.

use serde::Deserialize;
use std::collections::BTreeMap;

/// The exit code answers ONE question: can the user fix this by editing the
/// config? `1` (unreadable file) and `2` (bad argument) are `main.rs`'s and
/// predate this mode.
pub const EXIT_OK: i32 = 0;
pub const EXIT_INVALID_CONFIG: i32 = 3;
pub const EXIT_INTERNAL: i32 = 4;

/// Text mode lists at most this many diagnostics. A document with ten thousand
/// dangling references must not scroll a terminal off its own report; `--json`
/// still carries every one of them.
const MAX_LISTED_DIAGNOSTICS: usize = 20;

#[derive(Debug, Deserialize)]
pub struct ConfigErrorEntry {
  pub code: String,
  pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdEntry {
  pub selector: String,
  pub matched: u64,
  pub path_resolves: bool,
}

#[derive(Debug, Deserialize)]
pub struct RefEntry {
  pub from: String,
  pub to: String,
  pub matched: u64,
  pub resolved: u64,
  pub dangling: u64,
}

#[derive(Debug, Deserialize)]
pub struct DiagnosticEntry {
  pub code: String,
  pub path: String,
  pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
  /// The size of the graph, in the same unit as `entities` and `ref_edges`.
  pub nodes: u64,
  /// The same nodes plus the scalar rows, and THE ONLY COUNT `maxNodes` bounds:
  /// it is what `GraphTooLargeError` quotes, so it is the only one an agent that
  /// hit the cap can compare its retry against.
  pub logical_nodes: u64,
  pub entities: u64,
  pub ref_edges: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
  /// Wire version. Carried, not asserted on: the binary owns the bundle that
  /// produced it, so a mismatch here would mean the build is inconsistent with
  /// itself. The field exists for the SKILL FILE reading this output, which is
  /// not updated with the binary.
  pub report: u32,
  pub ok: bool,
  pub config_errors: Vec<ConfigErrorEntry>,
  /// A `BTreeMap`, so the text rendering is alphabetical and therefore stable
  /// between runs. The JSON is printed verbatim and keeps the config's own
  /// declaration order — the two orders differ on purpose, each serving its
  /// reader.
  pub ids: BTreeMap<String, IdEntry>,
  pub refs: Vec<RefEntry>,
  pub diagnostics: Vec<DiagnosticEntry>,
  pub totals: Totals,
}

pub fn parse(json: &str) -> Result<Report, String> {
  serde_json::from_str(json).map_err(|e| format!("report is not the expected shape: {e}"))
}

/// `ok` is computed once, in TypeScript (`validate.ts`), so the rule has a single
/// home. Here it only becomes a process code — deriving it again from the
/// report's contents would put the same rule in two languages, which is exactly
/// what embedding the core was meant to avoid.
pub fn classify(report: &Report) -> i32 {
  if report.ok {
    EXIT_OK
  } else {
    EXIT_INVALID_CONFIG
  }
}

pub fn render_text(report: &Report) -> String {
  let mut out = String::new();

  if report.ok {
    let resolved: u64 = report.refs.iter().map(|entry| entry.resolved).sum();
    out.push_str(&format!(
      "✓ config valid — {} entities, {} references resolved\n",
      report.totals.entities, resolved
    ));
  } else {
    out.push_str("✗ config invalid\n");
  }

  out.push('\n');
  // Everything between this mark and the diagnostics is one block: `errors`,
  // `ids` and `refs` read as a single table, so they are not separated from one
  // another — only from the verdict above and the diagnostics below.
  let mark = out.len();

  if !report.config_errors.is_empty() {
    out.push_str("  errors\n");
    for error in &report.config_errors {
      out.push_str(&format!("    {}  {}\n", error.code, error.message));
    }
  }

  if !report.ids.is_empty() {
    out.push_str("  ids\n");
    // Padding on `chars().count()`, not `len()`: a name or a selector holding a
    // non-ASCII character would otherwise shift its whole column.
    let name_width = report.ids.keys().map(|k| k.chars().count()).max().unwrap_or(0);
    let selector_width = report
      .ids
      .values()
      .map(|entry| entry.selector.chars().count())
      .max()
      .unwrap_or(0);
    for (name, entry) in &report.ids {
      let warning = if entry.path_resolves { "" } else { "  (path does not resolve)" };
      let unit = if entry.matched == 1 { "instance" } else { "instances" };
      out.push_str(&format!(
        "    {name:name_width$}  {:selector_width$}  {} {unit}{warning}\n",
        entry.selector, entry.matched
      ));
    }
  }

  if !report.refs.is_empty() {
    out.push_str("  refs\n");
    for entry in &report.refs {
      // The dangling RATIO, not just the count: `12/12 dangling` is the shape
      // that makes an entirely broken declaration visible without the exit code
      // having to guess whether the config or the data is at fault.
      let dangling = if entry.dangling > 0 {
        format!(", {}/{} dangling", entry.dangling, entry.matched)
      } else {
        String::new()
      };
      out.push_str(&format!(
        "    {} → {}    {}/{} resolved{dangling}\n",
        entry.from, entry.to, entry.resolved, entry.matched
      ));
    }
  }

  // A report with nothing between the verdict and the diagnostics — an empty
  // `ids` map — must not print two blank lines in a row.
  if out.len() > mark {
    out.push('\n');
  }

  if report.diagnostics.is_empty() {
    out.push_str("  No diagnostics.\n");
  } else {
    out.push_str(&format!("  diagnostics ({})\n", report.diagnostics.len()));
    for entry in report.diagnostics.iter().take(MAX_LISTED_DIAGNOSTICS) {
      out.push_str(&format!("    {}  {}\n", entry.code, entry.message));
    }
    if report.diagnostics.len() > MAX_LISTED_DIAGNOSTICS {
      out.push_str(&format!(
        "    … and {} more — use --json for the full list\n",
        report.diagnostics.len() - MAX_LISTED_DIAGNOSTICS
      ));
    }
  }

  out
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The wire format, written out as the TypeScript emits it, for
  /// `apps/demo/fixtures/shop.json` and its config — the counts are the measured
  /// ones. Parsing this is what proves the camelCase mapping holds: a renamed
  /// field would show up here and nowhere else on the Rust side.
  const VALID: &str = r#"{
    "report": 1,
    "ok": true,
    "configErrors": [],
    "ids": {
      "Customer": { "selector": "$.customers[*].id", "matched": 2, "pathResolves": true },
      "Order": { "selector": "$.orders[*].id", "matched": 2, "pathResolves": true }
    },
    "refs": [
      { "from": "$.orders[*].customerId", "to": "$.customers[*].id",
        "matched": 2, "resolved": 2, "dangling": 0 }
    ],
    "diagnostics": [],
    "totals": { "nodes": 11, "logicalNodes": 27, "entities": 4, "refEdges": 2 }
  }"#;

  const INVALID: &str = r#"{
    "report": 1,
    "ok": false,
    "configErrors": [
      { "code": "selector-syntax", "message": "Selector must start with \"$\": produits[*].id" }
    ],
    "ids": {},
    "refs": [],
    "diagnostics": [],
    "totals": { "nodes": 0, "logicalNodes": 0, "entities": 0, "refEdges": 0 }
  }"#;

  #[test]
  fn parses_the_camel_case_wire_format() {
    let report = parse(VALID).unwrap();
    assert_eq!(report.report, 1);
    assert!(report.ok);
    assert_eq!(report.totals.nodes, 11);
    assert_eq!(report.totals.logical_nodes, 27);
    assert_eq!(report.totals.ref_edges, 2);
    assert_eq!(report.ids["Customer"].matched, 2);
    assert!(report.ids["Customer"].path_resolves);
    assert_eq!(report.refs[0].resolved, 2);
  }

  #[test]
  fn a_malformed_report_is_an_error_not_a_panic() {
    assert!(parse("{\"nope\": true}").is_err());
  }

  #[test]
  fn a_valid_config_exits_zero() {
    assert_eq!(classify(&parse(VALID).unwrap()), EXIT_OK);
  }

  #[test]
  fn an_invalid_config_exits_three() {
    assert_eq!(classify(&parse(INVALID).unwrap()), EXIT_INVALID_CONFIG);
  }

  /// The whole layout, pinned exactly. Columns line up because "Order" is padded
  /// to the width of "Customer" (8) and "$.orders[*].id" to the width of
  /// "$.customers[*].id" (17), plus two literal spaces between columns; a blank
  /// line separates the verdict, the table and the diagnostics, and nothing else.
  #[test]
  fn the_text_report_states_the_verdict_and_the_counts() {
    let expected = [
      "✓ config valid — 4 entities, 2 references resolved",
      "",
      "  ids",
      "    Customer  $.customers[*].id  2 instances",
      "    Order     $.orders[*].id     2 instances",
      "  refs",
      "    $.orders[*].customerId → $.customers[*].id    2/2 resolved",
      "",
      "  No diagnostics.",
      "",
    ]
    .join("\n");
    assert_eq!(render_text(&parse(VALID).unwrap()), expected);
  }

  #[test]
  fn the_text_report_quotes_config_errors() {
    let text = render_text(&parse(INVALID).unwrap());
    assert!(text.starts_with("✗ config invalid"), "{text}");
    assert!(text.contains("selector-syntax  Selector must start with \"$\""), "{text}");
  }

  /// A selector matching exactly one row must read "1 instance", not "1
  /// instances" — the singular the plural format string silently dropped.
  #[test]
  fn a_single_match_is_singular() {
    let json = r#"{
      "report": 1, "ok": true, "configErrors": [],
      "ids": { "Order": { "selector": "$.orders[*].id", "matched": 1, "pathResolves": true } },
      "refs": [], "diagnostics": [],
      "totals": { "nodes": 1, "logicalNodes": 2, "entities": 1, "refEdges": 0 }
    }"#;
    let text = render_text(&parse(json).unwrap());
    assert!(text.contains("1 instance\n"), "{text}");
    assert!(!text.contains("1 instances"), "{text}");
  }

  /// Counts measured on the two-customers/two-orders document declaring only
  /// `$.produits[*].id`: the graph is built, nothing matches.
  #[test]
  fn an_unresolved_prefix_is_named_on_its_line() {
    let json = r#"{
      "report": 1, "ok": false, "configErrors": [],
      "ids": { "Produit": { "selector": "$.produits[*].id", "matched": 0, "pathResolves": false } },
      "refs": [], "diagnostics": [],
      "totals": { "nodes": 7, "logicalNodes": 15, "entities": 0, "refEdges": 0 }
    }"#;
    let text = render_text(&parse(json).unwrap());
    assert!(text.contains("0 instances  (path does not resolve)"), "{text}");
  }

  /// Counts measured on a document with an empty `customers` array and 12 orders
  /// all pointing at `c9`. The verdict stays `ok`: the config is fine, the data
  /// has a hole — and the ratio is what makes that hole impossible to miss.
  #[test]
  fn a_fully_dangling_declaration_shows_its_ratio() {
    let json = r#"{
      "report": 1, "ok": true, "configErrors": [], "ids": {},
      "refs": [ { "from": "$.orders[*].customerId", "to": "$.customers[*].id",
                  "matched": 12, "resolved": 0, "dangling": 12 } ],
      "diagnostics": [],
      "totals": { "nodes": 15, "logicalNodes": 39, "entities": 12, "refEdges": 12 }
    }"#;
    let text = render_text(&parse(json).unwrap());
    assert!(text.contains("0/12 resolved, 12/12 dangling"), "{text}");
  }

  /// The same document with 25 dangling orders instead of 12 — measured counts,
  /// so the literal describes a report the core can actually produce.
  #[test]
  fn the_text_report_truncates_a_flood_of_diagnostics() {
    let diagnostics: Vec<String> = (0..25)
      .map(|i| format!(r#"{{ "code": "dangling-ref", "path": "/orders/{i}", "message": "m{i}" }}"#))
      .collect();
    let json = format!(
      r#"{{ "report": 1, "ok": true, "configErrors": [], "ids": {{}}, "refs": [],
            "diagnostics": [{}],
            "totals": {{ "nodes": 28, "logicalNodes": 78, "entities": 25, "refEdges": 25 }} }}"#,
      diagnostics.join(",")
    );
    let text = render_text(&parse(&json).unwrap());
    assert!(text.contains("diagnostics (25)"), "{text}");
    assert!(text.contains("… and 5 more — use --json for the full list"), "{text}");
    assert!(!text.contains("m24"), "{text}");
  }
}
