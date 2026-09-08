//! Command-line parsing and file loading, BEFORE any window: launch errors must
//! surface where a CLI user expects them — on stderr, with an exit code — not
//! inside a WebView.
//!
//! Deliberately without clap: two arguments do not justify a dependency.
//! Messages and help text are in English (a spec decision); only SYNTACTIC JSON
//! validation happens here — semantic validation of the config (known entities,
//! selectors) stays in the TypeScript core, duplicating it in Rust would create
//! two truths.

pub const USAGE: &str = "datagraph - explore a JSON document as a graph of records and references

Usage:
  datagraph [<data.json>] [-c <config.json>]

Arguments:
  <data.json>       Path to the JSON document to open.
                    Without it, the app opens on the built-in demo dataset.

Options:
  -c <config.json>  Path to a JSON config declaring ids, refs
                    and groups. Without it, the document opens in
                    structure view only.
  -h, --help        Show this help and exit.";

#[derive(Debug, PartialEq)]
pub struct Cli {
  pub data_path: Option<String>,
  pub config_path: Option<String>,
  pub help: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct LaunchPayload {
  pub data: String,
  pub config: Option<String>,
}

/// Parses argv (without the program name). Pure: no disk access, so it stays
/// testable without fixtures.
pub fn parse(args: &[String]) -> Result<Cli, String> {
  let mut data_path: Option<String> = None;
  let mut config_path: Option<String> = None;
  let mut help = false;
  let mut it = args.iter();
  while let Some(arg) = it.next() {
    match arg.as_str() {
      "-h" | "--help" => help = true,
      "-c" => {
        let value = it.next().ok_or_else(|| "option '-c' expects a path".to_string())?;
        config_path = Some(value.clone());
      }
      s if s.starts_with('-') => return Err(format!("unknown option '{s}'")),
      s => {
        if data_path.is_some() {
          return Err(format!("unexpected argument '{s}'"));
        }
        data_path = Some(s.to_string());
      }
    }
  }
  // `-c` alone makes no sense: a config qualifies a document.
  if !help && config_path.is_some() && data_path.is_none() {
    return Err("option '-c' requires a data file argument".to_string());
  }
  Ok(Cli { data_path, config_path, help })
}

/// Reads the `Cli`'s files and checks each one is syntactically valid JSON.
/// `Ok(None)` = no file requested (demo mode).
pub fn load(cli: &Cli) -> Result<Option<LaunchPayload>, String> {
  let Some(data_path) = &cli.data_path else { return Ok(None) };
  let data = read_json(data_path)?;
  let config = match &cli.config_path {
    Some(path) => Some(read_json(path)?),
    None => None,
  };
  Ok(Some(LaunchPayload { data, config }))
}

/// The content is kept as a raw `String`: the frontend does the parsing, there
/// is no reason to deserialize here only to re-serialize towards the WebView.
fn read_json(path: &str) -> Result<String, String> {
  let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read '{path}': {e}"))?;
  serde_json::from_str::<serde::de::IgnoredAny>(&text)
    .map_err(|e| format!("'{path}' is not valid JSON: {e}"))?;
  Ok(text)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn no_args_means_demo_mode() {
    let cli = parse(&args(&[])).unwrap();
    assert_eq!(cli, Cli { data_path: None, config_path: None, help: false });
  }

  #[test]
  fn positional_is_the_data_path() {
    let cli = parse(&args(&["data.json"])).unwrap();
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path, None);
  }

  #[test]
  fn dash_c_takes_the_next_value() {
    let cli = parse(&args(&["data.json", "-c", "conf.json"])).unwrap();
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
    // The reverse order works too.
    let cli = parse(&args(&["-c", "conf.json", "data.json"])).unwrap();
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
  }

  #[test]
  fn help_flags_are_recognized() {
    assert!(parse(&args(&["--help"])).unwrap().help);
    assert!(parse(&args(&["-h"])).unwrap().help);
    // `--help` wins even when accompanied: the user asked for help, they get it.
    assert!(parse(&args(&["data.json", "--help"])).unwrap().help);
  }

  #[test]
  fn dash_c_without_value_is_an_error() {
    let err = parse(&args(&["data.json", "-c"])).unwrap_err();
    assert!(err.contains("'-c' expects a path"), "{err}");
  }

  #[test]
  fn unknown_option_is_an_error() {
    let err = parse(&args(&["--watch"])).unwrap_err();
    assert!(err.contains("unknown option '--watch'"), "{err}");
  }

  #[test]
  fn second_positional_is_an_error() {
    let err = parse(&args(&["a.json", "b.json"])).unwrap_err();
    assert!(err.contains("unexpected argument 'b.json'"), "{err}");
  }

  #[test]
  fn dash_c_alone_is_an_error() {
    let err = parse(&args(&["-c", "conf.json"])).unwrap_err();
    assert!(err.contains("requires a data file"), "{err}");
  }

  // --- load: fixtures written to the system temp directory, named by PID + test
  // name so that parallel tests do not step on each other.
  fn temp_file(name: &str, contents: &str) -> String {
    let path = std::env::temp_dir().join(format!("datagraph-cli-{}-{name}", std::process::id()));
    std::fs::write(&path, contents).unwrap();
    path.to_string_lossy().into_owned()
  }

  #[test]
  fn load_without_data_path_is_none() {
    let cli = Cli { data_path: None, config_path: None, help: false };
    assert_eq!(load(&cli).unwrap(), None);
  }

  #[test]
  fn load_reads_data_and_optional_config() {
    let data = temp_file("data.json", r#"{"customers": []}"#);
    let conf = temp_file("conf.json", r#"{"ids": {}}"#);
    let cli = Cli { data_path: Some(data), config_path: Some(conf), help: false };
    let payload = load(&cli).unwrap().unwrap();
    assert_eq!(payload.data, r#"{"customers": []}"#);
    assert_eq!(payload.config.as_deref(), Some(r#"{"ids": {}}"#));
  }

  #[test]
  fn load_missing_file_is_an_error() {
    let cli = Cli {
      data_path: Some("/nonexistent/nope.json".to_string()),
      config_path: None,
      help: false,
    };
    let err = load(&cli).unwrap_err();
    assert!(err.contains("cannot read '/nonexistent/nope.json'"), "{err}");
  }

  /// Validity guard for the COMMITTED fixtures: `fixtures/shop.json` and
  /// `fixtures/shop.config.json` are what the docs tell you to type after
  /// `datagraph`, and nothing else re-read them on the Rust side. The path
  /// starts from `CARGO_MANIFEST_DIR` (= `src-tauri/`) so as not to depend on
  /// the test runner's working directory. The semantic counterpart — is the
  /// config valid for the core — lives in `e2e/file-mode.spec.ts`; here we only
  /// prove what `load` promises: the files exist and are JSON.
  #[test]
  fn load_reads_the_committed_fixtures() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures");
    let cli = Cli {
      data_path: Some(format!("{dir}/shop.json")),
      config_path: Some(format!("{dir}/shop.config.json")),
      help: false,
    };
    let payload = load(&cli).unwrap().unwrap();
    assert!(payload.data.contains("\"customers\""), "{}", payload.data);
    let config = payload.config.expect("config fixture should be loaded");
    assert!(config.contains("\"ids\""), "{config}");
  }

  #[test]
  fn load_invalid_json_is_an_error() {
    let data = temp_file("bad.json", "{not json");
    let cli = Cli { data_path: Some(data.clone()), config_path: None, help: false };
    let err = load(&cli).unwrap_err();
    assert!(err.contains("is not valid JSON"), "{err}");
    assert!(err.contains(&data), "{err}");
  }
}
