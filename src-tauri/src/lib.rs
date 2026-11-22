//! Gitizen's Tauri backend: creates the window and registers the git
//! commands the UI calls through `src/api/gitizen.ts`.

mod ai_commit;
mod commands;
mod git;
mod recent_repos;

use git::repository::OpenRepository;
use ai_commit::AppSettings;
use recent_repos::RecentRepositories;

/// Starts the app. Called from `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenRepository::default())
        .manage(RecentRepositories::default())
        .manage(AppSettings::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_repository,
            commands::init_repository,
            commands::open_repository_at,
            recent_repos::recent_repositories,
            recent_repos::remember_repository,
            recent_repos::forget_repository,
            commands::status,
            commands::log,
            commands::branches,
            commands::file_diff,
            commands::file_text,
            commands::commit_files,
            commands::commit_diff,
            commands::stage,
            commands::unstage,
            commands::commit,
            commands::checkout,
            commands::set_staged_lines,
            ai_commit::ai_commit_command,
            ai_commit::set_ai_commit_command,
            ai_commit::generate_commit_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gitizen");
}
