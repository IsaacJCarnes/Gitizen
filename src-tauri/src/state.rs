//! Everything the window shows about the open repository, loaded in one
//! command for each refresh: status, history, branches, remotes, the
//! stopped operation (if any), every branch's stash and which commits may be
//! rewritten.
//!
//! One command instead of one per part lets the parts share what more than
//! one of them needs (the `git status` output gives the checked-out branch,
//! whether it has commits, and the conflicted files), and the independent
//! git calls run side by side on their own threads.

use ts_rs::TS;
use std::collections::HashMap;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::branches::branches_in;
use crate::conflicts::{conflict_state, parse_unmerged, ConflictState};
use crate::git::parsers::{head_is_unborn, parse_log, parse_status, LOG_FORMAT};
use crate::git::repository::{git_path, Repo};
use crate::git::runner::run_git;
use crate::git::types::{GitBranch, GitCommit, GitStatus};
use crate::history::rewritable_on;
use crate::remote::{remotes_in, Remote};
use crate::stash::{stashes_in, BranchStash};

/// Everything the window shows about the open repository, loaded together for each refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct RepositoryState {
    pub status: GitStatus,
    pub commits: Vec<GitCommit>,
    pub branches: Vec<GitBranch>,
    pub remotes: Vec<Remote>,
    pub conflicts: ConflictState,
    pub stashes: Vec<BranchStash>,
    /// Hashes of the commits that may be rewritten (see `history::rewritable_in`).
    pub rewritable: Vec<String>,
    /// For each changed file's path, a stamp that changes whenever its
    /// combined diff might (the file or the index was written), so the UI
    /// reloads a file's diff only then. Together with HEAD's commit, which
    /// the history gives.
    pub stamps: HashMap<String, String>,
}

/// When `path` was last written and its size ("" if it doesn't exist).
fn file_stamp(path: &Path) -> String {
    std::fs::metadata(path).map_or_else(
        |_| String::new(),
        |meta| {
            let written = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok());
            format!("{}:{}", written.map_or(0, |time| time.as_nanos()), meta.len())
        },
    )
}

/// `stamps` for the files of `status`: the index's stamp and the file's.
fn stamps_of(dir: &Path, status: &GitStatus) -> HashMap<String, String> {
    let index = git_path(dir, "index").map(|index| file_stamp(&index)).unwrap_or_default();
    status
        .files
        .iter()
        .map(|file| (file.path.clone(), format!("{index}/{}", file_stamp(&dir.join(&file.path)))))
        .collect()
}

#[tauri::command]
pub async fn repository_state(repo: Repo<'_>) -> Result<RepositoryState, String> {
    state_in(&repo.require()?)
}

pub(crate) fn state_in(dir: &Path) -> Result<RepositoryState, String> {
    std::thread::scope(|scope| {
        let commits = scope.spawn(|| log_in(dir));
        let branches = scope.spawn(|| branches_in(dir));
        let stashes = scope.spawn(|| stashes_in(dir));
        let remotes = scope.spawn(|| remotes_in(dir));

        // Status first on this thread; the conflicts and the rewritable
        // commits are worked out from it.
        // -z: NUL-separated entries, so paths with spaces or quotes come through as is.
        let output = run_git(dir, ["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"])?;
        let status = parse_status(&output);
        let conflicts = conflict_state(dir, parse_unmerged(&output));
        let rewritable = rewritable_on(dir, status.branch.as_deref(), !head_is_unborn(&output))?;
        let stamps = stamps_of(dir, &status);

        let joined = |name: &str| format!("Loading the {name} failed");
        Ok(RepositoryState {
            commits: commits.join().map_err(|_| joined("history"))??,
            branches: branches.join().map_err(|_| joined("branches"))??,
            stashes: stashes.join().map_err(|_| joined("stashes"))??,
            remotes: remotes.join().map_err(|_| joined("remotes"))?,
            status,
            conflicts,
            rewritable,
            stamps,
        })
    })
}

/// Every branch, remote and tag (stashes excluded), newest first with
/// children always before parents, which is what the commit graph needs.
pub(crate) fn log_in(dir: &Path) -> Result<Vec<GitCommit>, String> {
    let format = format!("--format={LOG_FORMAT}");
    let output = run_git(
        dir,
        ["log", "--decorate=full", "--exclude=refs/stash", "--all", "--date-order", "--max-count=500", &format],
    )?;
    Ok(parse_log(&output))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{commit_file, git, new_repo};

    #[test]
    fn loads_every_part_together() {
        let dir = new_repo("state");
        let empty = state_in(&dir).unwrap();
        assert_eq!(empty.status.branch.as_deref(), Some("main"));
        assert!(empty.commits.is_empty() && empty.branches.is_empty() && empty.rewritable.is_empty());

        commit_file(&dir, "a.txt", "a\n");
        git(&dir, &["branch", "side"]);
        commit_file(&dir, "b.txt", "b\n");
        std::fs::write(dir.join("b.txt"), "changed\n").unwrap();
        let state = state_in(&dir).unwrap();
        assert_eq!(state.commits.len(), 2);
        assert_eq!(state.status.files.len(), 1);
        assert_eq!(state.rewritable, vec![state.commits[0].hash.clone()]);
        assert_eq!(state.conflicts.operation, None);
        assert!(state.remotes.is_empty() && state.stashes.is_empty());
        // The stamp changes when the file is written, and when it is staged.
        let stamp = |state: &RepositoryState| state.stamps["b.txt"].clone();
        let before = stamp(&state);
        assert_eq!(stamp(&state_in(&dir).unwrap()), before);
        std::fs::write(dir.join("b.txt"), "changed again\n").unwrap();
        let written = stamp(&state_in(&dir).unwrap());
        assert_ne!(written, before);
        git(&dir, &["add", "b.txt"]);
        assert_ne!(stamp(&state_in(&dir).unwrap()), written);
        let side = state.branches.iter().find(|branch| branch.name == "side").unwrap();
        assert_eq!((side.current, side.ahead, side.behind), (false, 0, 1));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
