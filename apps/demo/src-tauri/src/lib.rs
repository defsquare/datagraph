pub mod cli;
pub mod report;

use cli::LaunchPayload;

/// The only command exposed: the launch payload read by `main.rs`. Application
/// commands (invoke_handler) do not go through the capabilities — those only
/// guard plugin and core permissions.
#[tauri::command]
fn launch_payload(state: tauri::State<'_, Option<LaunchPayload>>) -> Option<LaunchPayload> {
  state.inner().clone()
}

/// `payload` is `None` in demo mode (no file on the command line).
pub fn run_with(payload: Option<LaunchPayload>) {
  tauri::Builder::default()
    .manage(payload)
    .invoke_handler(tauri::generate_handler![launch_payload])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// The mobile entry point carries no argv: it always starts in demo mode.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  run_with(None)
}
