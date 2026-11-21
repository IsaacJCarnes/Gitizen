//! The repository the window currently has open, plus small helpers for
//! validating UI input and finding a commit's first parent.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::runner::run_git;

/// Holds the open repository's folder. The app works on one repository at a
/// time, so this is a single slot kept in Tauri's managed state.
#[derive(Default)]
pub struct OpenRepository(Mutex<Option<PathBuf>>);

impl OpenRepository {
    /// Opens `directory` as the current repository.
    /// Fails if the folder is not inside a git work tree.
    pub fn open(&self, directory: PathBuf) -> Result<(), String> {
        let inside = run_git(&directory, ["rev-parse", "--is-inside-work-tree"])
            .map(|output| output.trim() == "true")
            .unwrap_or(false);
        if !inside {
            return Err("That folder is not a git repository".into());
        }
        *self.0.lock().map_err(|_| "Repository state is unavailable")? = Some(directory);
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

/// git's well-known empty tree, used as the "parent" of a root commit.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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
    fn rejects_option_like_branch_names() {
        assert!(assert_branch_name("main").is_ok());
        assert!(assert_branch_name("feature/x").is_ok());
        assert!(assert_branch_name("-f").is_err());
        assert!(assert_branch_name("").is_err());
    }
}
