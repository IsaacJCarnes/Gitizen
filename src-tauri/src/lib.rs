//! Gitizen's Tauri backend: creates the window and registers the git
//! commands the UI calls through `src/api/gitizen.ts`.

mod ai_commit;
mod commands;
mod commit_actions;
mod conflicts;
mod discard;
mod git;
mod recent_repos;
mod remote;
mod util;

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
            commands::undo_last_commit,
            commands::stash_changes,
            commands::checkout,
            commands::set_staged_lines,
            discard::discard_files,
            discard::discard_lines,
            ai_commit::ai_commit_command,
            ai_commit::set_ai_commit_command,
            ai_commit::generate_commit_message,
            remote::remotes,
            remote::add_remote,
            remote::publish_repository,
            remote::fetch,
            remote::pull,
            remote::push,
            commit_actions::checkout_commit,
            commit_actions::create_branch,
            commit_actions::create_tag,
            commit_actions::cherry_pick,
            commit_actions::open_in_browser,
            conflicts::conflicts,
            conflicts::resolve_conflict,
            conflicts::continue_operation,
            conflicts::abort_operation,
            conflicts::ai_resolve_conflict,
            conflicts::conflict_versions,
            conflicts::save_conflict_resolution,
            conflicts::ai_resolve_command,
            conflicts::set_ai_resolve_command,
            conflicts::editor_command,
            conflicts::set_editor_command,
            conflicts::open_in_merge_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gitizen");
}
