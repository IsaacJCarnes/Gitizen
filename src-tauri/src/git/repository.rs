//! The repository the window currently has open, plus small helpers for
//! validating UI input and finding a commit's first parent.

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

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
        *self.slot()? = Some(directory);
        Ok(())
    }

    /// Returns the open repository's folder, or an error if none is open.
    pub fn require(&self) -> Result<PathBuf, String> {
        self.slot()?.clone().ok_or_else(|| "No repository open".to_string())
    }

    fn slot(&self) -> Result<MutexGuard<'_, Option<PathBuf>>, String> {
        self.0.lock().map_err(|_| "Repository state is unavailable".to_string())
    }
}

/// How commands receive the open repository from Tauri's managed state.
pub type Repo<'a> = tauri::State<'a, OpenRepository>;

/// The checked-out branch's short name, or None when HEAD is detached.
pub fn current_branch(dir: &Path) -> Option<String> {
    // --quiet makes a detached HEAD a plain failure instead of an error message.
    run_git(dir, ["symbolic-ref", "--short", "--quiet", "HEAD"])
        .ok()
        .map(|name| name.trim().to_string())
}

/// The checked-out branch, for operations that need one; `doing` finishes
/// the error, e.g. "HEAD is detached. Check out a branch before merging."
pub fn require_current_branch(dir: &Path, doing: &str) -> Result<String, String> {
    current_branch(dir).ok_or_else(|| format!("HEAD is detached. Check out a branch before {doing}."))
}

/// Fails unless tracked files are unchanged (untracked files don't count),
/// for operations that switch branches or replay commits.
pub fn require_clean(dir: &Path, doing: &str) -> Result<(), String> {
    let changes = run_git(dir, ["status", "--porcelain", "--untracked-files=no"])?;
    if changes.trim().is_empty() {
        Ok(())
    } else {
        Err(format!("Commit or stash your changes before {doing}."))
    }
}

/// True once HEAD points at a commit (false in a new, empty repository).
pub fn has_commits(dir: &Path) -> bool {
    run_git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok()
}

/// Where `name` (e.g. "MERGE_HEAD") is in the git folder. `--git-path`
/// resolves inside worktrees and custom git dirs too; the printed path is
/// relative to `dir` (or absolute), so it is joined on.
pub fn git_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = run_git(dir, ["rev-parse", "--git-path", name])?;
    Ok(dir.join(path.trim()))
}

/// The text of file `name` in the git folder, or None if it can't be read.
pub fn read_git_file(dir: &Path, name: &str) -> Option<String> {
    std::fs::read_to_string(git_path(dir, name).ok()?).ok()
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
    // 4 is git's shortest abbreviation; 64 is a full SHA-256 hash.
    let valid = (4..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit());
    valid.then_some(hash).ok_or_else(|| "Invalid commit hash".into())
}

/// Rejects branch names git would read as an option, such as "--force".
pub fn assert_branch_name(name: &str) -> Result<&str, String> {
    let valid = !name.is_empty() && !name.starts_with('-');
    valid.then_some(name).ok_or_else(|| "Invalid branch name".into())
}

/// A name a new branch can take: `assert_branch_name`, plus git's own rules
/// (`check-ref-format --branch` rejects e.g. "a..b" or "x.lock").
pub fn assert_new_branch_name<'a>(dir: &Path, name: &'a str) -> Result<&'a str, String> {
    let name = assert_branch_name(name)?;
    run_git(dir, ["check-ref-format", "--branch", name])
        .map(|_| name)
        .map_err(|_| format!("\"{name}\" isn't a valid branch name"))
}

/// Returns the first parent of `hash`, or the empty tree for a root commit.
/// Commit diffs are taken against the first parent, so a merge shows what it
/// brought in.
pub fn first_parent_of(repo: &Path, hash: &str) -> Result<String, String> {
    // Prints "<hash> <parent1> <parent2>...", so the second word is the first parent.
    let line = run_git(repo, ["rev-list", "--parents", "-n", "1", hash])?;
    Ok(line.split_whitespace().nth(1).unwrap_or(EMPTY_TREE).to_string())
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
        let dir = crate::util::unique_temp_dir("open-test").unwrap();
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
        assert_eq!(current_branch(&dir).as_deref(), Some("main"));
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
