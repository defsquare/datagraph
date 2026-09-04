pub mod cli;

use cli::LaunchPayload;

/// Seule commande exposée : le payload de lancement lu par `main.rs`. Les
/// commandes d'application (invoke_handler) ne passent pas par les capabilities
/// — celles-ci ne gardent que les permissions des plugins et du core.
#[tauri::command]
fn launch_payload(state: tauri::State<'_, Option<LaunchPayload>>) -> Option<LaunchPayload> {
  state.inner().clone()
}

/// `payload` est `None` en mode démo (aucun fichier sur la ligne de commande).
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

// L'entrée mobile ne porte pas d'argv : elle démarre toujours en mode démo.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  run_with(None)
}
