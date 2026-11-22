//! The list of repositories Gitizen has opened, most recent first, kept in
//! `recent-repositories.json` in the app's config folder so it survives
//! restarts. The UI reads it through the `recent_repositories` command and
//! adds to it with `remember_repository` once a repository has loaded.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Manager, State};

/// How many repositories the list keeps; the oldest drop off the end.
pub const MAX_RECENT: usize = 15;

const FILE_NAME: &str = "recent-repositories.json";

/// Serialises reads and writes of the list file so two quick opens can't
/// interleave and lose an entry.
#[derive(Default)]
pub struct RecentRepositories(Mutex<()>);

impl RecentRepositories {
    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.0.lock().map_err(|_| "Recent repositories are unavailable".to_string())
    }
}

/// Moves `path` to the front of `list`, removing any earlier copy, and trims
/// the list to `MAX_RECENT`.
pub fn with_remembered(list: Vec<String>, path: &str) -> Vec<String> {
    let mut list = without(list, path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
    list
}

/// Removes every copy of `path` from `list`.
pub fn without(mut list: Vec<String>, path: &str) -> Vec<String> {
    list.retain(|entry| !same_path(entry, path));
    list
}

/// Compares paths ignoring trailing separators, and case on Windows, where
/// the file system ignores it too.
fn same_path(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_end_matches(['/', '\\']), b.trim_end_matches(['/', '\\']));
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// Parses the saved file. A missing or unreadable file is an empty list, so
/// a corrupt file never stops the app from starting.
fn parse(contents: &str) -> Vec<String> {
    serde_json::from_str(contents).unwrap_or_default()
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    Ok(dir.join(FILE_NAME))
}

fn load(app: &AppHandle) -> Result<Vec<String>, String> {
    let path = file_path(app)?;
    Ok(std::fs::read_to_string(path).map(|text| parse(&text)).unwrap_or_default())
}

fn save(app: &AppHandle, list: &[String]) -> Result<(), String> {
    let path = file_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(list).map_err(|error| error.to_string())?;
    std::fs::write(path, text).map_err(|error| error.to_string())
}

/// Applies `change` to the saved list, saves it and returns the new list.
fn update(
    app: &AppHandle,
    state: &RecentRepositories,
    change: impl FnOnce(Vec<String>) -> Vec<String>,
) -> Result<Vec<String>, String> {
    let _guard = state.lock()?;
    let list = change(load(app)?);
    save(app, &list)?;
    Ok(list)
}

/// The saved repositories, most recent first.
#[tauri::command]
pub async fn recent_repositories(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
) -> Result<Vec<String>, String> {
    let _guard = state.lock()?;
    load(&app)
}

/// Puts `path` at the top of the list. Call it only after the repository
/// opened successfully. Returns the new list.
#[tauri::command]
pub async fn remember_repository(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
    path: String,
) -> Result<Vec<String>, String> {
    update(&app, &state, |list| with_remembered(list, &path))
}

/// Removes `path` from the list. Returns the new list.
#[tauri::command]
pub async fn forget_repository(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
    path: String,
) -> Result<Vec<String>, String> {
    update(&app, &state, |list| without(list, &path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| path.to_string()).collect()
    }

    #[test]
    fn remembering_moves_a_path_to_the_front_once() {
        let recent = with_remembered(list(&["/a", "/b", "/c"]), "/b");
        assert_eq!(recent, list(&["/b", "/a", "/c"]));
        let recent = with_remembered(recent, "/d");
        assert_eq!(recent, list(&["/d", "/b", "/a", "/c"]));
        assert_eq!(with_remembered(list(&["/a/"]), "/a"), list(&["/a"]));
    }

    #[test]
    fn keeps_at_most_max_recent() {
        let mut recent = Vec::new();
        for index in 0..MAX_RECENT + 5 {
            recent = with_remembered(recent, &format!("/repo{index}"));
        }
        assert_eq!(recent.len(), MAX_RECENT);
        assert_eq!(recent[0], format!("/repo{}", MAX_RECENT + 4));
    }

    #[test]
    fn forgetting_removes_the_path() {
        assert_eq!(without(list(&["/a", "/b"]), "/a"), list(&["/b"]));
        assert_eq!(without(list(&["/a"]), "/x"), list(&["/a"]));
    }

    #[test]
    fn unreadable_file_is_an_empty_list() {
        assert_eq!(parse("not json"), Vec::<String>::new());
        assert_eq!(parse(r#"["/a","/b"]"#), list(&["/a", "/b"]));
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_match_ignoring_case() {
        assert_eq!(with_remembered(list(&["D:\\Repo"]), "d:\\repo"), list(&["d:\\repo"]));
    }
}
