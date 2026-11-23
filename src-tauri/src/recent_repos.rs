//! The list of repositories Gitizen has opened, most recent first, kept in
//! `recent-repositories.json` in the app's config folder so it survives
//! restarts. The UI reads it through the `recent_repositories` command and
//! adds to it with `remember_repository` once a repository has loaded.

use tauri::{AppHandle, State};

use crate::util::ConfigFile;

/// How many repositories the list keeps; the oldest drop off the end.
pub const MAX_RECENT: usize = 15;

/// The list file, kept in Tauri's managed state.
pub(crate) type RecentRepositories = ConfigFile<Vec<String>>;

impl Default for RecentRepositories {
    fn default() -> Self {
        ConfigFile::new("recent-repositories.json")
    }
}

/// Moves `path` to the front of `list`, removing any earlier copy, and trims
/// the list to `MAX_RECENT`.
pub fn remember(list: &mut Vec<String>, path: &str) {
    forget(list, path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
}

/// Removes every copy of `path` from `list`.
pub fn forget(list: &mut Vec<String>, path: &str) {
    list.retain(|entry| !same_path(entry, path));
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

/// The saved repositories, most recent first.
#[tauri::command]
pub async fn recent_repositories(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
) -> Result<Vec<String>, String> {
    state.read(&app)
}

/// Puts `path` at the top of the list. Call it only after the repository
/// opened successfully. Returns the new list.
#[tauri::command]
pub async fn remember_repository(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
    path: String,
) -> Result<Vec<String>, String> {
    state.update(&app, |list| remember(list, &path))
}

/// Removes `path` from the list. Returns the new list.
#[tauri::command]
pub async fn forget_repository(
    app: AppHandle,
    state: State<'_, RecentRepositories>,
    path: String,
) -> Result<Vec<String>, String> {
    state.update(&app, |list| forget(list, &path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::parse_config;

    fn list(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|path| path.to_string()).collect()
    }

    fn with_remembered(mut list: Vec<String>, path: &str) -> Vec<String> {
        remember(&mut list, path);
        list
    }

    fn without(mut list: Vec<String>, path: &str) -> Vec<String> {
        forget(&mut list, path);
        list
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
        assert_eq!(parse_config::<Vec<String>>("not json"), Vec::<String>::new());
        assert_eq!(parse_config::<Vec<String>>(r#"["/a","/b"]"#), list(&["/a", "/b"]));
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths_match_ignoring_case() {
        assert_eq!(with_remembered(list(&["D:\\Repo"]), "d:\\repo"), list(&["d:\\repo"]));
    }
}
