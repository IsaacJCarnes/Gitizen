//! Opening, creating and closing the repository the window works on.

use std::path::PathBuf;

use tauri::AppHandle;

use crate::git::repository::{init_repository as git_init, OpenError, Repo};
use crate::util::pick_folder;
/// Shows a folder picker and opens the chosen repository. Returns its path,
/// or None if the picker was cancelled. A folder that isn't a repository
/// fails with `OpenError::NotARepository` so the UI can offer `init_repository`.
#[tauri::command]
pub async fn open_repository(app: AppHandle, repo: Repo<'_>) -> Result<Option<String>, OpenError> {
    let Some(directory) = pick_folder(&app)? else {
        return Ok(None);
    };
    repo.open(directory.clone())?;
    Ok(Some(directory.to_string_lossy().into_owned()))
}

/// Opens the repository at `path` without a picker, e.g. one chosen from the
/// recent repositories list. Returns the path. Fails like `open_repository`
/// (so a folder that is no longer a repository can be re-initialised), or
/// with a plain failure if the folder is gone.
#[tauri::command]
pub async fn open_repository_at(repo: Repo<'_>, path: String) -> Result<String, OpenError> {
    let directory = PathBuf::from(&path);
    if !directory.is_dir() {
        return Err(format!("{path} no longer exists").into());
    }
    repo.open(directory)?;
    Ok(path)
}

/// Closes the open repository, going back to the start screen (after it
/// was removed from the recent list, or its folder was deleted).
#[tauri::command]
pub async fn close_repository(
    repo: Repo<'_>,
    watcher: tauri::State<'_, crate::watcher::RepositoryWatcher>,
) -> Result<(), String> {
    watcher.stop();
    repo.close()
}

/// True while `path` is still a folder inside a git work tree.
#[tauri::command]
pub async fn repository_exists(path: String) -> bool {
    let directory = PathBuf::from(path);
    directory.is_dir() && crate::git::repository::is_work_tree(&directory)
}

/// Runs `git init` in `path` (a folder the user picked that isn't a
/// repository yet) and opens it. Returns the path.
#[tauri::command]
pub async fn init_repository(repo: Repo<'_>, path: String) -> Result<String, String> {
    let directory = PathBuf::from(&path);
    git_init(&directory)?;
    repo.open(directory)?;
    Ok(path)
}

