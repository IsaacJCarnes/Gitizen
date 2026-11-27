//! Gitizen's Tauri backend: creates the window and registers the git
//! commands the UI calls through `src/api/gitizen.ts`.

mod ai_commit;
mod branches;
mod clone;
mod commit_actions;
mod conflicts;
mod discard;
mod edit_file;
mod git;
mod github;
mod history;
mod image_diff;
mod open;
mod recent_repos;
mod remote;
mod settings;
mod stash;
mod state;
mod util;
mod watcher;
mod working_tree;

use git::repository::OpenRepository;
use github::GitHubSession;
use settings::AppSettings;
use recent_repos::RecentRepositories;

/// Starts the app. Called from `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(OpenRepository::default())
        .manage(RecentRepositories::default())
        .manage(AppSettings::default())
        .manage(GitHubSession::default())
        .manage(watcher::RepositoryWatcher::default())
        .setup(|_app| {
            // Debug builds (`npm run app:dev`) say so in the title bar, so they
            // can't be mistaken for an installed release.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                for window in _app.webview_windows().values() {
                    let _ = window.set_title("Gitizen (dev)");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open::open_repository,
            open::init_repository,
            open::open_repository_at,
            open::close_repository,
            open::repository_exists,
            recent_repos::recent_repositories,
            recent_repos::remember_repository,
            recent_repos::forget_repository,
            watcher::watch_repository,
            state::repository_state,
            working_tree::file_diff,
            working_tree::file_text,
            working_tree::commit_files,
            working_tree::commit_diff,
            working_tree::stage,
            working_tree::unstage,
            working_tree::commit,
            working_tree::undo_last_commit,
            stash::stash_changes,
            stash::pop_stash,
            stash::drop_stash,
            stash::stash_diff,
            image_diff::image_versions,
            working_tree::checkout,
            working_tree::set_staged_lines,
            discard::discard_files,
            discard::discard_lines,
            edit_file::can_edit_file,
            edit_file::working_file,
            edit_file::save_working_file,
            settings::saved_command,
            settings::save_command,
            ai_commit::generate_commit_message,
            github::github_account,
            github::github_sign_in,
            github::github_sign_in_with_token,
            github::github_sign_out,
            clone::github_repositories,
            clone::choose_folder,
            clone::clone_repository,
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
            history::revert_commit,
            history::reset_to_commit,
            history::squash_commits,
            history::delete_tag,
            history::push_tag,
            branches::switch_branch,
            branches::rename_branch,
            branches::delete_branch,
            branches::merge_branch,
            branches::rebase_onto_branch,
            branches::squash_merge_branch,
            conflicts::resolve_conflict,
            conflicts::continue_operation,
            conflicts::abort_operation,
            conflicts::ai_resolve_conflict,
            conflicts::conflict_versions,
            conflicts::save_conflict_resolution,
            conflicts::open_in_merge_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gitizen");
}
