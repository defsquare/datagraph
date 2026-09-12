//! The embedded engine: the `--check` mode's JavaScript half.
//!
//! The bundle is generated from `packages/core` and COMMITTED (see
//! `pnpm --filter @defsquare/data-graph-core generate:check`). `include_str!`
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

/// The data is arbitrary, so both bounds are set even though the JavaScript is
/// ours and frozen at compile time.
///
/// Memory: the core calibrates its own `maxNodes` default (1,000,000) against a
/// ~1.5 GB target, and QuickJS was measured at 569 MB on that tier. The limit
/// sits at the CALIBRATION, not at the measurement, so that the core's own cap —
/// which names the way out — stays the thing that fires first on a legitimate
/// document.
const MEMORY_LIMIT: usize = 1536 * 1024 * 1024;

/// Stack: `buildGraph` walks the document by recursion, and so does `JSON.parse`.
/// This is QuickJS's own SOFT check on the interpreter's recursion, tracked from
/// the point it starts running — it must stay strictly under the OS stack of the
/// thread the engine actually runs on (see `THREAD_STACK_SIZE`), so that a
/// document too deeply nested raises a catchable `RangeError: Maximum call stack
/// size exceeded` — which exits 4 — instead of overrunning the real, native
/// stack and aborting the process with no exit code at all.
const STACK_LIMIT: usize = 4 * 1024 * 1024;

/// The OS stack size of the thread `run_check` spawns to run the engine on.
/// `run_check` is `pub` on a lib crate that is ALSO the Tauri app's lib crate:
/// nothing stops a future command from calling it off a worker whose own stack
/// is far smaller than the 8 MiB macOS/Linux default — `std::thread::spawn`
/// itself defaults to 2 MiB, and the MSVC default main-thread stack on Windows
/// is commonly 1 MiB. Running on a thread we create ourselves, with a stack size
/// we choose, makes the bound hold no matter what thread calls in.
///
/// Set to double `STACK_LIMIT` so QuickJS's own soft check always fires first:
/// the interpreter's tracked budget (4 MiB) leaves a full `STACK_LIMIT` of
/// headroom underneath it for everything QuickJS's check does not itself
/// account for — the Rust/FFI frames between `spawn`'s closure and the
/// interpreter loop, and `describe`'s own stack use once an error is caught.
const THREAD_STACK_SIZE: usize = 2 * STACK_LIMIT;

/// Two strings in, one string out. Rust deserializes NOTHING of the user's data:
/// the JavaScript parses it and hands the report back as text. That is the same
/// argument `cli.rs` already makes on `read_json`, and `load()` already returns
/// the `String`s that go straight in here.
///
/// Runs on a thread this function spawns itself (see `THREAD_STACK_SIZE`), not
/// on the caller's — the stack bound above is only meaningful if the OS stack it
/// is compared against is one we sized on purpose.
pub fn run_check(data: &str, config: &str) -> Result<String, String> {
  let data = data.to_string();
  let config = config.to_string();
  std::thread::Builder::new()
    .stack_size(THREAD_STACK_SIZE)
    .spawn(move || run_check_on_this_thread(&data, &config))
    .map_err(|e| e.to_string())?
    .join()
    .map_err(|_| "engine thread panicked".to_string())?
}

fn run_check_on_this_thread(data: &str, config: &str) -> Result<String, String> {
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
    let json: String = check.call((data, config)).map_err(|error| describe(&ctx, error))?;
    Ok(json)
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
  use crate::report;

  /// The committed fixtures, which are what the docs tell you to type after
  /// `datagraph`. `CARGO_MANIFEST_DIR` is `src-tauri/`, so this does not depend on
  /// the test runner's working directory.
  fn fixture(name: &str) -> String {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
    std::fs::read_to_string(format!("{dir}/{name}")).unwrap()
  }

  #[test]
  fn the_bundle_evaluates_and_exposes_the_boundary() {
    let json = run_check("{}", r#"{"ids": {}}"#).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(parsed.report, 1);
    assert!(parsed.ok);
  }

  #[test]
  fn strings_cross_the_boundary_unchanged() {
    // A config error message carrying quotes: nothing on the Rust side re-encodes
    // it, so what the core wrote is what the user reads.
    let json = run_check("{}", r#"{"ids": {"X": "produits[*].id"}}"#).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(parsed.config_errors[0].code, "selector-syntax");
    assert_eq!(
      parsed.config_errors[0].message,
      "Selector must start with \"$\": produits[*].id"
    );
    assert_eq!(report::classify(&parsed), report::EXIT_INVALID_CONFIG);
  }

  /// The gift the check mode makes to the existing suite. `load_reads_the
  /// _committed_fixtures` could only prove the files exist and are JSON; the
  /// semantic counterpart used to live in `e2e/file-mode.spec.ts`. It can now be
  /// proved here, without Playwright.
  #[test]
  fn the_committed_fixtures_are_a_valid_config() {
    let json = run_check(&fixture("shop.json"), &fixture("shop.config.json")).unwrap();
    let parsed = report::parse(&json).unwrap();
    assert_eq!(report::classify(&parsed), report::EXIT_OK);
    // Measured on the fixture: 11 graph nodes, 27 logical ones. The two differ,
    // which is exactly why both travel — only the second is what `maxNodes`
    // bounds.
    assert_eq!(parsed.totals.nodes, 11);
    assert_eq!(parsed.totals.logical_nodes, 27);
    assert_eq!(parsed.totals.entities, 4);
    assert_eq!(parsed.totals.ref_edges, 2);
    assert_eq!(parsed.ids["Customer"].matched, 2);
    assert!(parsed.ids["Order"].path_resolves);
    assert_eq!(parsed.refs[0].resolved, 2);
    assert!(parsed.diagnostics.is_empty());
  }

  #[test]
  fn an_unresolved_prefix_exits_three() {
    let config = r#"{"ids": {"Produit": "$.produits[*].id"}}"#;
    let parsed = report::parse(&run_check(&fixture("shop.json"), config).unwrap()).unwrap();
    assert!(!parsed.ids["Produit"].path_resolves);
    assert_eq!(report::classify(&parsed), report::EXIT_INVALID_CONFIG);
  }

  #[test]
  fn a_dangling_reference_stays_valid() {
    // A foreign key pointing at nothing is a hole in the DATA. Exit 0, with the
    // diagnostic to read.
    let data = r#"{"customers": [{"id": "c1"}], "orders": [{"id": "o1", "customerId": "c9"}]}"#;
    let parsed = report::parse(&run_check(data, &fixture("shop.config.json")).unwrap()).unwrap();
    assert_eq!(report::classify(&parsed), report::EXIT_OK);
    assert_eq!(parsed.diagnostics[0].code, "dangling-ref");
    assert_eq!(parsed.refs[0].dangling, 1);
  }

  /// The regression `THREAD_STACK_SIZE` exists for. Before running the engine on
  /// its own thread, this document reliably took down the whole test binary —
  /// `std::thread::spawn`'s 2 MiB default is smaller than `STACK_LIMIT` (4 MiB),
  /// so the native stack overflowed before QuickJS's own soft check could catch
  /// anything, and Rust turns that into an unrecoverable process abort, not a
  /// panic `cargo test` could report. Nesting depth is the same order of
  /// magnitude measured to trigger it (100,000): deep enough that `JSON.parse`'s
  /// recursive descent exhausts QuickJS's 4 MiB budget well before finishing.
  #[test]
  fn a_document_nested_too_deeply_returns_an_error_instead_of_aborting() {
    let depth = 200_000;
    let data = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    let error = run_check(&data, r#"{"ids": {}}"#).unwrap_err();
    assert!(
      error.contains("call stack"),
      "expected a stack-overflow message, got: {error}"
    );
  }

  /// The regression the `None if value.is_null()` branch of `describe` exists
  /// for. Reproducing the real trigger — memory running out at the exact instant
  /// QuickJS allocates the `Error` object for its own `JS_ThrowOutOfMemory` —
  /// turned out to be UNSAFE to drive from a test: probing this crate's actual
  /// `set_memory_limit` down toward the few hundred kilobytes bootstrap needs
  /// does not fail gracefully at every step. Measured directly against this
  /// build: 16 KiB and 48–96 KiB return a clean `Err`, but 32 KiB aborts the
  /// whole process (SIGABRT) and 128 KiB segfaults it (SIGSEGV) — non-monotonic,
  /// so no single "safe" constant can be pinned down, and a value safe today
  /// could shift under a future `rquickjs`/QuickJS bump or a different platform.
  /// Committing a test that risks taking down the entire test binary is exactly
  /// the failure mode this task exists to close, so it is not exercised via
  /// `run_check`.
  ///
  /// What actually distinguishes the two `None` branches in `describe` is not
  /// WHY the pending exception is `null` — QuickJS's C source (`JS_ThrowError2`,
  /// "out of memory: throw JS_NULL to avoid recursing") sets exactly the same
  /// `JS_TAG_NULL` pending exception that a script's own `throw null` does. That
  /// makes `throw null` a faithful, deterministic, crash-free stand-in for the
  /// real OOM race, exercising the identical code path in `describe` without
  /// needing QuickJS to actually run out of memory.
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
