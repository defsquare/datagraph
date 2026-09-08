// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// All the CLI routing lives BEFORE `run_with`: help and errors must never open a
// window. (On Windows in release, `windows_subsystem = "windows"` leaves
// println/eprintln without a console — accepted: the primary target is launching
// from a macOS/Linux shell.)
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
