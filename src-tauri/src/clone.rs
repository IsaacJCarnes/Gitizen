//! Cloning a repository, from a URL or from the signed-in GitHub account's
//! list of repositories, into a folder the user picks; the clone is then
//! opened like any repository.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::git::repository::Repo;
use crate::git::runner::run_git;
use crate::github::{self, GitHub};
use crate::util::blocking;

/// One of the signed-in account's GitHub repositories (its own, a
/// collaborator's, or an organization's it belongs to).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    /// "owner/name".
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub description: Option<String>,
    /// The https URL to clone.
    pub clone_url: String,
    /// When it was last pushed to or changed, in ISO 8601.
    pub updated_at: String,
}

/// Most repositories listed (10 pages of GitHub's maximum 100).
const MAX_PAGES: u32 = 10;

/// The signed-in account's repositories, most recently updated first.
#[tauri::command]
pub async fn github_repositories(github: GitHub<'_>) -> Result<Vec<GitHubRepository>, String> {
    let github = github.inner().clone();
    blocking(move || {
        let token = github.token()?;
        let mut repositories = Vec::new();
        for page in 1..=MAX_PAGES {
            let path = format!(
                "/user/repos?per_page=100&page={page}&sort=updated\
                 &affiliation=owner,collaborator,organization_member"
            );
            let listed = github::get(&token, &path)?;
            let items = listed.as_array().cloned().unwrap_or_default();
            repositories.extend(items.iter().filter_map(repository_from));
            if items.len() < 100 {
                break;
            }
        }
        Ok(repositories)
    })
    .await
}

fn repository_from(item: &serde_json::Value) -> Option<GitHubRepository> {
    let text = |key: &str| item[key].as_str().map(str::to_string);
    Some(GitHubRepository {
        full_name: text("full_name")?,
        name: text("name")?,
        owner: item["owner"]["login"].as_str()?.to_string(),
        private: item["private"].as_bool().unwrap_or(false),
        description: text("description").filter(|description| !description.is_empty()),
        clone_url: text("clone_url")?,
        updated_at: text("updated_at").unwrap_or_default(),
    })
}

/// Shows a folder picker. Returns the chosen folder, or None if cancelled.
#[tauri::command]
pub async fn choose_folder(app: AppHandle) -> Result<Option<String>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Clones `url` into a new folder `name` inside `parent` and opens it.
/// Returns the clone's path. git's credential helper signs in when the
/// repository needs it.
#[tauri::command]
pub async fn clone_repository(
    repo: Repo<'_>,
    url: String,
    parent: String,
    name: String,
) -> Result<String, String> {
    let destination = blocking(move || clone_in(url.trim(), Path::new(parent.trim()), name.trim())).await?;
    repo.open(destination.clone())?;
    Ok(destination.to_string_lossy().into_owned())
}

fn clone_in(url: &str, parent: &Path, name: &str) -> Result<PathBuf, String> {
    if url.is_empty() || url.starts_with('-') {
        return Err("Enter the URL of the repository to clone.".into());
    }
    if !parent.is_dir() {
        return Err("Choose an existing folder to clone into.".into());
    }
    if name.is_empty() || name.starts_with('-') || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Enter a folder name for the clone (without slashes).".into());
    }
    let destination = parent.join(name);
    let occupied = std::fs::read_dir(&destination).map_or(destination.exists(), |mut entries| entries.next().is_some());
    if occupied {
        return Err(format!("{} already exists and isn't empty.", destination.display()));
    }
    // "--" so the URL and folder can never be read as options.
    let target = destination.to_string_lossy().into_owned();
    run_git(parent, ["clone", "--", url, target.as_str()])?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{commit_file, new_repo};
    use crate::util::unique_temp_dir;

    #[test]
    fn clones_into_a_new_folder() {
        let source = new_repo("clone-source");
        commit_file(&source, "a.txt", "a\n");
        let parent = unique_temp_dir("clone-parent").unwrap();
        let url = source.to_string_lossy().into_owned();

        assert!(clone_in("", &parent, "x").is_err());
        assert!(clone_in("--upload-pack=evil", &parent, "x").is_err());
        assert!(clone_in(&url, &parent.join("missing"), "x").is_err());
        assert!(clone_in(&url, &parent, "a/b").is_err());

        let cloned = clone_in(&url, &parent, "copy").unwrap();
        assert!(cloned.join("a.txt").exists());
        // A folder that already has something in it is refused.
        let error = clone_in(&url, &parent, "copy").unwrap_err();
        assert!(error.contains("isn't empty"), "{error}");
        // An empty one is fine.
        std::fs::create_dir(parent.join("empty")).unwrap();
        clone_in(&url, &parent, "empty").unwrap();

        let _ = std::fs::remove_dir_all(&source);
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn reads_listed_repositories() {
        let item = serde_json::json!({
            "full_name": "octo/hello", "name": "hello", "owner": { "login": "octo" },
            "private": true, "description": "", "clone_url": "https://github.com/octo/hello.git",
            "updated_at": "2026-11-24T10:00:00Z"
        });
        let repository = repository_from(&item).unwrap();
        assert_eq!(repository.full_name, "octo/hello");
        assert!(repository.private);
        assert_eq!(repository.description, None);
        assert_eq!(repository_from(&serde_json::json!({ "name": "x" })), None);
    }
}
