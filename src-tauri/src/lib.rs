//! Gitizen's Tauri backend: creates the window and registers the git
//! commands the UI calls through `src/api/gitizen.ts`.

mod commands;
mod git;

use git::repository::OpenRepository;

/// Starts the app. Called from `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenRepository::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::status,
            commands::log,
            commands::branches,
            commands::diff,
            commands::file_diff,
            commands::file_text,
            commands::commit_files,
            commands::commit_diff,
            commands::stage,
            commands::unstage,
            commands::commit,
            commands::checkout,
            commands::set_staged_lines,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gitizen");
}
