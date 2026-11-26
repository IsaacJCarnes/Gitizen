//! Everything the window shows about the open repository, loaded in one
//! command for each refresh: status, history, branches, remotes, the
//! stopped operation (if any), every branch's stash and which commits may be
//! rewritten.
//!
//! One command instead of one per part lets the parts share what more than
//! one of them needs (the `git status` output gives the checked-out branch,
//! whether it has commits, and the conflicted files), and the independent
//! git calls run side by side on their own threads.

use std::path::Path;

use serde::Serialize;

use crate::branches::branches_in;
use crate::conflicts::{conflict_state, parse_unmerged, ConflictState};
use crate::git::parsers::{head_is_unborn, parse_log, parse_status, LOG_FORMAT};
use crate::git::repository::Repo;
use crate::git::runner::run_git;
use crate::git::types::{GitBranch, GitCommit, GitStatus};
use crate::history::rewritable_on;
use crate::remote::{remotes_in, Remote};
use crate::stash::{stashes_in, BranchStash};

/// What `repository_state` returns (`RepositoryState` in shared/gitTypes.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepositoryState {
    pub status: GitStatus,
    pub commits: Vec<GitCommit>,
    pub branches: Vec<GitBranch>,
    pub remotes: Vec<Remote>,
    pub conflicts: ConflictState,
    pub stashes: Vec<BranchStash>,
    /// Hashes of the commits that may be rewritten (see `history::rewritable_in`).
    pub rewritable: Vec<String>,
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

        let joined = |name: &str| format!("Loading the {name} failed");
        Ok(RepositoryState {
            commits: commits.join().map_err(|_| joined("history"))??,
            branches: branches.join().map_err(|_| joined("branches"))??,
            stashes: stashes.join().map_err(|_| joined("stashes"))??,
            remotes: remotes.join().map_err(|_| joined("remotes"))?,
            status,
            conflicts,
            rewritable,
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
        let side = state.branches.iter().find(|branch| branch.name == "side").unwrap();
        assert_eq!((side.current, side.ahead, side.behind), (false, 0, 1));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
