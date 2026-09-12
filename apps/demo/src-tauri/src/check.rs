//! The embedded engine: the `--check` mode's JavaScript half.
//!
//! The bundle is generated from `packages/core` and COMMITTED (see
//! `pnpm --filter @defsquare/datagraph-core generate:check`). `include_str!`
//! needs it at Rust compile time, and cargo must never depend on pnpm; its
//! freshness is a vitest matter, not a cargo one.
//!
//! Nothing is injected into the context. The validation closure was measured to
//! expect no host global — no `console`, no timers, no `fetch` — so the safe
//! posture is simply the default. `Context::full` is still required: "full" here
//! means the STANDARD intrinsics (`JSON`, `RegExp`, `Map`, `Set`), which the core
//! does use, whereas `Context::base` would leave `JSON` undefined.

use rquickjs::{Context, Ctx, Function, Runtime};

const BUNDLE: &str = include_str!("../generated/check.js");

/// Exit 0 and 3 are the bundle's to decide — the verdict lives in `validate.ts`;
/// `1` (unreadable file) and `2` (bad argument) are `main.rs`'s and `cli.rs`'s.
/// This is the only code Rust itself reaches: the engine failed, or the core has
/// a bug. Never a verdict on the user's config.
pub const EXIT_INTERNAL: i32 = 4;

/// The core calibrates its own `maxNodes` default (1,000,000) against a ~1.5 GB
/// target, and QuickJS was measured at 569 MB on that tier. The limit sits at the
/// CALIBRATION, not at the measurement, so the core's own cap — which names the
/// way out — stays the thing that fires first on a legitimate document.
const MEMORY_LIMIT: usize = 1536 * 1024 * 1024;

/// QuickJS's SOFT check on interpreter recursion (`buildGraph` and `JSON.parse`
/// both descend recursively). It must stay strictly under the smallest realistic
/// OS thread stack — 1 MiB for the MSVC main thread, 2 MiB for
/// `std::thread::spawn`'s default — so a document nested too deeply raises a
/// catchable `RangeError` instead of overrunning the native stack and aborting
/// the process with no exit code at all.
///
/// The CLI cannot even deliver such a document: `cli.rs::read_json` rejects
/// anything nested past serde_json's default recursion limit of 128 first. This
/// bound is for direct callers of this `pub` function.
const STACK_LIMIT: usize = 512 * 1024;

/// Three values in, one string out: `<exit code>\n<rendered output>`. Rust
/// deserializes NOTHING — not the user's data, not the report. The JavaScript
/// parses, renders and decides the code; this only splits the envelope, so the
/// report's shape, its rendering and the exit-code rule keep a single home in
/// `validate.ts`.
pub fn run_check(data: &str, config: &str, as_json: bool) -> Result<(i32, String), String> {
  let runtime = Runtime::new().map_err(|e| e.to_string())?;
  runtime.set_memory_limit(MEMORY_LIMIT);
  runtime.set_max_stack_size(STACK_LIMIT);
  let context = Context::full(&runtime).map_err(|e| e.to_string())?;
  context.with(|ctx| {
    ctx.eval::<(), _>(BUNDLE).map_err(|error| describe(&ctx, error))?;
    let check: Function = ctx
      .globals()
      .get("__datagraph_check")
      .map_err(|error| describe(&ctx, error))?;
    let out: String = check
      .call((data, config, as_json))
      .map_err(|error| describe(&ctx, error))?;
    let (code, output) = out
      .split_once('\n')
      .ok_or_else(|| "report carries no exit-code line".to_string())?;
    let code: i32 = code
      .parse()
      .map_err(|_| format!("report carries a malformed exit code: {code:?}"))?;
    Ok((code, output.to_string()))
  })
}

/// A `rquickjs::Error::Exception` carries no message of its own: the thrown value
/// has to be fetched from the context. Without this, the only thing surfacing
/// would be the word "exception" — precisely the useless diagnostic an exit 4
/// must never be, since it is what tells someone the fault is ours and not their
/// config's.
///
/// One case needs its own branch: when memory runs out at the exact instant
/// QuickJS tries to allocate the `Error` object for the exception it is
/// throwing, it cannot — and raises the bare `null` value instead.
/// `is_exception()` is still true, `as_exception()` is `None`, and without this
/// check the fallback below would print the `Value`'s `Debug` form verbatim
/// (`Null"null"`), which tells nobody that memory is what ran out.
fn describe(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
  if !error.is_exception() {
    return error.to_string();
  }
  let value = ctx.catch();
  match value.as_exception() {
    Some(exception) => exception.message().unwrap_or_else(|| exception.to_string()),
    None if value.is_null() => "memory limit exceeded".to_string(),
    None => error.to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::Value;

  /// The committed fixtures, which are what the docs tell you to type after
  /// `datagraph`. `CARGO_MANIFEST_DIR` is `src-tauri/`, so this does not depend on
  /// the test runner's working directory.
  fn fixture(name: &str) -> String {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
    std::fs::read_to_string(format!("{dir}/{name}")).unwrap()
  }

  /// Asserted through `--json` and a `serde_json::Value`: what these tests check
  /// is that the fields CROSS the boundary, not a Rust shape this crate no longer
  /// owns.
  fn json_report(data: &str, config: &str) -> (i32, Value) {
    let (code, out) = run_check(data, config, true).unwrap();
    (code, serde_json::from_str(&out).unwrap())
  }

  #[test]
  fn the_bundle_evaluates_and_exposes_the_boundary() {
    let (code, report) = json_report("{}", r#"{"ids": {}}"#);
    assert_eq!(code, 0);
    assert_eq!(report["report"], 1);
    assert_eq!(report["ok"], true);
  }

  #[test]
  fn strings_cross_the_boundary_unchanged() {
    // A config error message carrying quotes: nothing on the Rust side re-encodes
    // it, so what the core wrote is what the user reads.
    let (code, report) = json_report("{}", r#"{"ids": {"X": "produits[*].id"}}"#);
    assert_eq!(code, 3);
    assert_eq!(report["configErrors"][0]["code"], "selector-syntax");
    assert_eq!(
      report["configErrors"][0]["message"],
      "Selector must start with \"$\": produits[*].id"
    );
  }

  /// The gift the check mode makes to the existing suite. `load_reads_the
  /// _committed_fixtures` could only prove the files exist and are JSON; the
  /// semantic counterpart used to live in `e2e/file-mode.spec.ts`. It can now be
  /// proved here, without Playwright.
  #[test]
  fn the_committed_fixtures_are_a_valid_config() {
    let (code, report) = json_report(&fixture("shop.json"), &fixture("shop.config.json"));
    assert_eq!(code, 0);
    // Measured on the fixture: 11 graph nodes, 27 logical ones. The two differ,
    // which is exactly why both travel — only the second is what `maxNodes`
    // bounds.
    assert_eq!(report["totals"]["nodes"], 11);
    assert_eq!(report["totals"]["logicalNodes"], 27);
    assert_eq!(report["totals"]["entities"], 4);
    assert_eq!(report["totals"]["refEdges"], 2);
    assert_eq!(report["ids"]["Customer"]["matched"], 2);
    assert_eq!(report["ids"]["Order"]["pathResolves"], true);
    assert_eq!(report["refs"][0]["resolved"], 2);
    assert!(report["diagnostics"].as_array().unwrap().is_empty());
  }

  #[test]
  fn an_unresolved_prefix_exits_three() {
    let config = r#"{"ids": {"Produit": "$.produits[*].id"}}"#;
    let (code, report) = json_report(&fixture("shop.json"), config);
    assert_eq!(code, 3);
    assert_eq!(report["ids"]["Produit"]["pathResolves"], false);
  }

  #[test]
  fn a_dangling_reference_stays_valid() {
    // A foreign key pointing at nothing is a hole in the DATA. Exit 0, with the
    // diagnostic to read.
    let data = r#"{"customers": [{"id": "c1"}], "orders": [{"id": "o1", "customerId": "c9"}]}"#;
    let (code, report) = json_report(data, &fixture("shop.config.json"));
    assert_eq!(code, 0);
    assert_eq!(report["diagnostics"][0]["code"], "dangling-ref");
    assert_eq!(report["refs"][0]["dangling"], 1);
  }

  /// Why `STACK_LIMIT` is what it is. This depth exhausts QuickJS's soft budget
  /// during `JSON.parse`'s descent, and 512 KiB is low enough that the soft check
  /// fires on the test harness's own thread — before the native stack overflows,
  /// which Rust turns into an unrecoverable process abort rather than a panic
  /// `cargo test` could report.
  #[test]
  fn a_document_nested_too_deeply_returns_an_error_instead_of_aborting() {
    let depth = 200_000;
    let data = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    let error = run_check(&data, r#"{"ids": {}}"#, false).unwrap_err();
    assert!(
      error.contains("call stack"),
      "expected a stack-overflow message, got: {error}"
    );
  }

  /// The regression the `None if value.is_null()` branch of `describe` exists
  /// for. The real trigger — memory running out at the exact instant QuickJS
  /// allocates the `Error` object for its own `JS_ThrowOutOfMemory` — is UNSAFE
  /// to drive from a test: probing `set_memory_limit` down toward the few hundred
  /// kilobytes bootstrap needs was measured non-monotonic on this build (16 KiB
  /// and 48–96 KiB return a clean `Err`, 32 KiB aborts the process, 128 KiB
  /// segfaults it), so no "safe" constant can be pinned down, and committing a
  /// test that may take down the whole binary is the failure mode to avoid.
  ///
  /// `throw null` is a faithful stand-in: QuickJS's own `JS_ThrowError2` ("out of
  /// memory: throw JS_NULL to avoid recursing") sets exactly the same
  /// `JS_TAG_NULL` pending exception, so `describe` runs the identical path,
  /// deterministically and crash-free.
  #[test]
  fn a_null_pending_exception_is_named_as_a_memory_limit() {
    let runtime = Runtime::new().unwrap();
    let context = Context::full(&runtime).unwrap();
    context.with(|ctx| {
      let error = ctx.eval::<(), _>("throw null;").unwrap_err();
      assert!(error.is_exception());
      assert_eq!(describe(&ctx, error), "memory limit exceeded");
    });
  }
}
