//! Parsing de la ligne de commande et chargement des fichiers, AVANT toute
//! fenêtre : les erreurs de lancement doivent arriver là où un utilisateur de
//! CLI les attend — sur stderr, avec un code de sortie — pas dans une WebView.
//!
//! Volontairement sans clap : deux arguments ne justifient pas une dépendance.
//! Messages et aide en anglais (décision de spec) ; seule la validation
//! SYNTAXIQUE du JSON se fait ici — la validation sémantique de la config
//! (entités connues, sélecteurs) reste au cœur TypeScript, la dupliquer en
//! Rust créerait deux vérités.

pub const USAGE: &str = "datagraph - explore a JSON document as an entity graph

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

/// Parse argv (sans le nom du programme). Pur : aucune lecture disque, pour
/// rester testable sans fixtures.
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
  // `-c` seul n'a pas de sens : la config qualifie un document.
  if !help && config_path.is_some() && data_path.is_none() {
    return Err("option '-c' requires a data file argument".to_string());
  }
  Ok(Cli { data_path, config_path, help })
}

/// Lit les fichiers du `Cli` et vérifie que chacun est du JSON syntaxiquement
/// valide. `Ok(None)` = pas de fichier demandé (mode démo).
pub fn load(cli: &Cli) -> Result<Option<LaunchPayload>, String> {
  let Some(data_path) = &cli.data_path else { return Ok(None) };
  let data = read_json(data_path)?;
  let config = match &cli.config_path {
    Some(path) => Some(read_json(path)?),
    None => None,
  };
  Ok(Some(LaunchPayload { data, config }))
}

/// Le contenu est gardé en `String` brute : c'est le frontend qui parse, il n'y
/// a aucune raison de désérialiser ici pour re-sérialiser vers la WebView.
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
    // L'ordre inverse marche aussi.
    let cli = parse(&args(&["-c", "conf.json", "data.json"])).unwrap();
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
  }

  #[test]
  fn help_flags_are_recognized() {
    assert!(parse(&args(&["--help"])).unwrap().help);
    assert!(parse(&args(&["-h"])).unwrap().help);
    // `--help` gagne même accompagné : l'utilisateur demande l'aide, on la donne.
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

  // --- load : fixtures écrites dans le dossier temporaire du système, nommées
  // par PID + nom de test pour que les tests parallèles ne se marchent pas dessus.
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

  #[test]
  fn load_invalid_json_is_an_error() {
    let data = temp_file("bad.json", "{not json");
    let cli = Cli { data_path: Some(data.clone()), config_path: None, help: false };
    let err = load(&cli).unwrap_err();
    assert!(err.contains("is not valid JSON"), "{err}");
    assert!(err.contains(&data), "{err}");
  }
}
