// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use data_graph_lib::{check, cli, report};

// All CLI routing lives BEFORE `run_with`: help, argument errors, and `--check`
// must never open a window. `run_check_mode` is typed `-> !`, so control only
// reaches `run_with` once none of the earlier branches applied — the compiler
// enforces it, not a defensive check inside `run_with` itself. (On Windows in
// release, `windows_subsystem = "windows"` leaves println/eprintln without a
// console — accepted: the primary target is launching from a macOS/Linux shell.)
fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let parsed = match cli::parse(&args) {
    Ok(parsed) => parsed,
    Err(message) => {
      eprintln!("datagraph: {message}\n\n{}", cli::USAGE);
      std::process::exit(2);
    }
  };
  if parsed.help {
    println!("{}", cli::USAGE);
    return;
  }
  let payload = match cli::load(&parsed) {
    Ok(payload) => payload,
    Err(message) => {
      eprintln!("datagraph: {message}");
      std::process::exit(1);
    }
  };
  // The check mode returns from HERE. `run_with` is never reached, so no window
  // can open: that is the shape of the flow, not a precaution taken inside it.
  if parsed.check {
    run_check_mode(payload.as_ref(), parsed.json);
  }
  data_graph_lib::run_with(payload);
}

/// Never returns: every path exits the process with the code the report earned.
fn run_check_mode(payload: Option<&cli::LaunchPayload>, as_json: bool) -> ! {
  // `parse` guarantees `--check` comes with `-c`, and `-c` with a data file, so
  // both strings are here. The branch exists because an impossible state must
  // still name itself rather than panic — and it is OUR fault, hence exit 4.
  let Some((data, config)) = payload.and_then(|p| p.config.as_ref().map(|c| (&p.data, c))) else {
    eprintln!("datagraph: internal error: --check reached without both files");
    std::process::exit(report::EXIT_INTERNAL);
  };

  let json = match check::run_check(data, config) {
    Ok(json) => json,
    Err(message) => {
      // A stack overflow, an exhausted memory budget or a core bug. Telling an
      // agent its config is wrong when the fault is ours condemns it to edit a
      // correct file forever, so this can never be a 3.
      eprintln!("datagraph: internal error: {message}");
      std::process::exit(report::EXIT_INTERNAL);
    }
  };
  let parsed = match report::parse(&json) {
    Ok(parsed) => parsed,
    Err(message) => {
      eprintln!("datagraph: internal error: {message}");
      std::process::exit(report::EXIT_INTERNAL);
    }
  };

  if as_json {
    // Printed VERBATIM: re-serializing would round-trip the report through a
    // second encoder for no reason, and would let the two spellings drift.
    println!("{json}");
  } else {
    print!("{}", report::render_text(&parsed));
  }
  std::process::exit(report::classify(&parsed));
}
