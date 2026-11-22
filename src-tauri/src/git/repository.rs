//! The repository the window currently has open, plus small helpers for
//! validating UI input and finding a commit's first parent.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use super::runner::run_git;

/// Why a folder could not be opened. Serialised for the UI as
/// `{ "kind": "notARepository", "path", "message" }` or
/// `{ "kind": "failed", "message" }` (see `OpenRepositoryError` in
/// `shared/ipc.ts`), so the UI can offer to create a repository instead of
/// only showing the message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenError {
    /// The folder exists but is not inside a git work tree.
    NotARepository { path: String, message: String },
    /// Anything else, carrying git's (or our) message.
    Failed { message: String },
}

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OpenError::NotARepository { message, .. } | OpenError::Failed { message } => {
                f.write_str(message)
            }
        }
    }
}

impl From<String> for OpenError {
    fn from(message: String) -> Self {
        OpenError::Failed { message }
    }
}

/// Lets callers that return plain `String` errors keep using `?`.
impl From<OpenError> for String {
    fn from(error: OpenError) -> Self {
        error.to_string()
    }
}

/// Holds the open repository's folder. The app works on one repository at a
/// time, so this is a single slot kept in Tauri's managed state.
#[derive(Default)]
pub struct OpenRepository(Mutex<Option<PathBuf>>);

impl OpenRepository {
    /// Opens `directory` as the current repository.
    /// Fails with `OpenError::NotARepository` if the folder is not inside a
    /// git work tree.
    pub fn open(&self, directory: PathBuf) -> Result<(), OpenError> {
        if !is_work_tree(&directory) {
            return Err(OpenError::NotARepository {
                path: directory.to_string_lossy().into_owned(),
                message: "That folder is not a git repository".into(),
            });
        }
        *self.0.lock().map_err(|_| "Repository state is unavailable".to_string())? =
            Some(directory);
        Ok(())
    }

    /// Returns the open repository's folder, or an error if none is open.
    pub fn require(&self) -> Result<PathBuf, String> {
        self.0
            .lock()
            .map_err(|_| "Repository state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "No repository open".to_string())
    }
}

/// True when `directory` is inside a git work tree.
pub fn is_work_tree(directory: &Path) -> bool {
    run_git(directory, ["rev-parse", "--is-inside-work-tree"])
        .map(|output| output.trim() == "true")
        .unwrap_or(false)
}

/// Runs `git init` in `directory`, which must be an existing folder that is
/// not already inside a work tree (so a repository is never nested by
/// accident). The first branch is always `main`, whatever git's configured
/// default is.
pub fn init_repository(directory: &Path) -> Result<(), String> {
    if !directory.is_dir() {
        return Err("That folder does not exist".into());
    }
    if is_work_tree(directory) {
        return Err("That folder is already a git repository".into());
    }
    run_git(directory, ["init"])?;
    // `git init -b` needs git 2.28+; pointing HEAD at main works everywhere.
    run_git(directory, ["symbolic-ref", "HEAD", "refs/heads/main"]).map(drop)
}

/// git's well-known empty tree, used as the "parent" of a root commit.
pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Rejects anything that isn't a hex commit hash, so UI input can never be
/// read by git as an option or a revision expression.
pub fn assert_hash(hash: &str) -> Result<&str, String> {
    let valid = (4..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit());
    if valid {
        Ok(hash)
    } else {
        Err("Invalid commit hash".into())
    }
}

/// Rejects branch names git would read as an option, such as "--force".
pub fn assert_branch_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.starts_with('-') {
        Err("Invalid branch name".into())
    } else {
        Ok(name)
    }
}

/// Returns the first parent of `hash`, or the empty tree for a root commit.
/// Commit diffs are taken against the first parent, so a merge shows what it
/// brought in.
pub fn first_parent_of(repo: &Path, hash: &str) -> Result<String, String> {
    let line = run_git(repo, ["rev-list", "--parents", "-n", "1", hash])?;
    Ok(line
        .split_whitespace()
        .nth(1)
        .unwrap_or(EMPTY_TREE)
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_hex_hashes_only() {
        assert!(assert_hash("abc1234").is_ok());
        assert!(assert_hash(&"f".repeat(40)).is_ok());
        assert!(assert_hash("abc").is_err());
        assert!(assert_hash("--all").is_err());
        assert!(assert_hash("HEAD~1").is_err());
        assert!(assert_hash(&"a".repeat(65)).is_err());
    }

    #[test]
    fn open_reports_non_repositories_with_their_path() {
        let dir = std::env::temp_dir().join(format!(
            "gitizen-open-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = OpenRepository::default();

        let error = repo.open(dir.clone()).unwrap_err();
        assert_eq!(
            error,
            OpenError::NotARepository {
                path: dir.to_string_lossy().into_owned(),
                message: "That folder is not a git repository".into(),
            }
        );
        assert_eq!(
            serde_json::to_value(&error).unwrap()["kind"],
            serde_json::json!("notARepository")
        );
        assert!(repo.require().is_err());

        init_repository(&dir).unwrap();
        assert_eq!(run_git(&dir, ["symbolic-ref", "--short", "HEAD"]).unwrap().trim(), "main");
        assert!(init_repository(&dir).unwrap_err().contains("already"));
        repo.open(dir.clone()).unwrap();
        assert_eq!(repo.require().unwrap(), dir);
        assert!(init_repository(&dir.join("missing")).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_option_like_branch_names() {
        assert!(assert_branch_name("main").is_ok());
        assert!(assert_branch_name("feature/x").is_ok());
        assert!(assert_branch_name("-f").is_err());
        assert!(assert_branch_name("").is_err());
    }
}
