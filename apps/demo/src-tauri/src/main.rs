// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Tout l'aiguillage CLI vit AVANT `run_with` : aide et erreurs ne doivent
// jamais ouvrir de fenêtre. (Sur Windows en release, `windows_subsystem =
// "windows"` prive println/eprintln de console — assumé : la cible primaire
// est le lancement depuis un shell macOS/Linux.)
fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let cli = match data_graph_lib::cli::parse(&args) {
    Ok(cli) => cli,
    Err(message) => {
      eprintln!("datagraph: {message}\n\n{}", data_graph_lib::cli::USAGE);
      std::process::exit(2);
    }
  };
  if cli.help {
    println!("{}", data_graph_lib::cli::USAGE);
    return;
  }
  let payload = match data_graph_lib::cli::load(&cli) {
    Ok(payload) => payload,
    Err(message) => {
      eprintln!("datagraph: {message}");
      std::process::exit(1);
    }
  };
  data_graph_lib::run_with(payload);
}
