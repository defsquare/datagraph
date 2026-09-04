// Aucune commande `#[tauri::command]` n'est exposée : la démo est intégralement
// frontend (Pixi/WebGL dans la WebView) et ne demande rien à l'hôte. Toute
// commande ajoutée ici devrait aussi être autorisée dans capabilities/default.json.
pub mod cli;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
