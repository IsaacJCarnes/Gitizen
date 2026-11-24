//! Managing local branches from their right-click menu: renaming and
//! deleting them, and bringing another branch into the current one by
//! merging, rebasing onto it, or squashing it into a single commit.

use std::path::Path;

use crate::conflicts::unless_conflicted;
use crate::git::repository::{
    assert_branch_name, assert_new_branch_name, current_branch, git_path, require_clean,
    require_current_branch, Repo,
};
use crate::git::runner::run_git;

/// How many commits `branch` has that HEAD doesn't (ahead), and HEAD has
/// that `branch` doesn't (behind). Both 0 when HEAD has no commits yet.
pub(crate) fn ahead_behind(dir: &Path, branch: &str) -> (u32, u32) {
    // "<left>\t<right>": left counts HEAD's own commits, right the branch's.
    let range = format!("HEAD...refs/heads/{branch}");
    let counts = run_git(dir, ["rev-list", "--left-right", "--count", range.as_str()]).unwrap_or_default();
    let mut numbers = counts.split_whitespace().map(|n| n.parse().unwrap_or(0));
    let behind = numbers.next().unwrap_or(0);
    let ahead = numbers.next().unwrap_or(0);
    (ahead, behind)
}

/// Fails unless `name` is an existing local branch.
fn require_branch<'a>(dir: &Path, name: &'a str) -> Result<&'a str, String> {
    let name = assert_branch_name(name)?;
    let full = format!("refs/heads/{name}");
    run_git(dir, ["show-ref", "--verify", "--quiet", full.as_str()])
        .map(|_| name)
        .map_err(|_| format!("There is no branch named {name}"))
}

/// Renames branch `name` to `new_name`. Its upstream setting moves along.
#[tauri::command]
pub async fn rename_branch(repo: Repo<'_>, name: String, new_name: String) -> Result<(), String> {
    rename_in(&repo.require()?, &name, new_name.trim())
}

fn rename_in(dir: &Path, name: &str, new_name: &str) -> Result<(), String> {
    let name = require_branch(dir, name)?;
    let new_name = assert_new_branch_name(dir, new_name)?;
    run_git(dir, ["branch", "-m", name, new_name]).map(drop)
}

/// Deletes local branch `name` (never the checked-out one). Without
/// `force`, git refuses if the branch has commits merged nowhere else.
#[tauri::command]
pub async fn delete_branch(repo: Repo<'_>, name: String, force: bool) -> Result<(), String> {
    delete_in(&repo.require()?, &name, force)
}

fn delete_in(dir: &Path, name: &str, force: bool) -> Result<(), String> {
    let name = require_branch(dir, name)?;
    if current_branch(dir).as_deref() == Some(name) {
        return Err(format!("{name} is checked out. Switch to another branch to delete it."));
    }
    run_git(dir, ["branch", if force { "-D" } else { "-d" }, name]).map(drop)
}

/// Merges `name` into the current branch (a merge commit unless it can
/// fast-forward). Stopping on conflicts succeeds, leaving them to the
/// conflict editor.
#[tauri::command]
pub async fn merge_branch(repo: Repo<'_>, name: String) -> Result<(), String> {
    merge_in(&repo.require()?, &name)
}

fn merge_in(dir: &Path, name: &str) -> Result<(), String> {
    let name = require_branch(dir, name)?;
    require_current_branch(dir, "merging")?;
    unless_conflicted(dir, run_git(dir, ["merge", "--no-edit", name]).map(drop))
}

/// Replays the current branch's own commits on top of `name`. Needs a
/// clean working tree. Stopping on conflicts succeeds, as for a merge.
#[tauri::command]
pub async fn rebase_onto_branch(repo: Repo<'_>, name: String) -> Result<(), String> {
    rebase_in(&repo.require()?, &name)
}

fn rebase_in(dir: &Path, name: &str) -> Result<(), String> {
    let name = require_branch(dir, name)?;
    let current = require_current_branch(dir, "rebasing")?;
    require_clean(dir, &format!("rebasing {current}"))?;
    unless_conflicted(dir, run_git(dir, ["rebase", name]).map(drop))
}

/// Brings every change of `name` into the current branch as one new
/// commit with `message`, leaving `name` itself as it is. On conflicts the
/// message is kept for the commit that finishes it, once they are resolved.
#[tauri::command]
pub async fn squash_merge_branch(repo: Repo<'_>, name: String, message: String) -> Result<(), String> {
    squash_in(&repo.require()?, &name, message.trim())
}

fn squash_in(dir: &Path, name: &str, message: &str) -> Result<(), String> {
    let name = require_branch(dir, name)?;
    require_current_branch(dir, "squash merging")?;
    if message.is_empty() {
        return Err("Enter a commit message for the squashed changes.".into());
    }
    let (ahead, _) = ahead_behind(dir, name);
    if ahead == 0 {
        return Err(format!("{name} has no commits to squash into the current branch."));
    }
    match run_git(dir, ["merge", "--squash", name]) {
        Ok(_) => run_git(dir, ["commit", "-m", message]).map(drop),
        Err(error) => {
            // Stopped on conflicts: commit later with this message (git
            // reads MERGE_MSG first), via the commit form.
            if let Ok(path) = git_path(dir, "MERGE_MSG") {
                let _ = std::fs::write(path, format!("{message}\n"));
            }
            unless_conflicted(dir, Err(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::util::test_support::{commit_file, git, new_repo};

    /// main: base.txt; side (from it): s1.txt, s2.txt; main then: m.txt.
    fn diverged() -> std::path::PathBuf {
        let dir = new_repo("branches");
        commit_file(&dir, "base.txt", "base\n");
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit_file(&dir, "s1.txt", "1\n");
        commit_file(&dir, "s2.txt", "2\n");
        git(&dir, &["checkout", "-q", "main"]);
        commit_file(&dir, "m.txt", "m\n");
        dir
    }

    fn count(dir: &Path, spec: &str) -> String {
        git(dir, &["rev-list", "--count", spec]).trim().to_string()
    }

    #[test]
    fn renames_and_deletes_branches() {
        let dir = diverged();
        assert_eq!(ahead_behind(&dir, "side"), (2, 1));
        assert_eq!(ahead_behind(&dir, "main"), (0, 0));

        rename_in(&dir, "side", "feature/side").unwrap();
        assert!(require_branch(&dir, "feature/side").is_ok() && require_branch(&dir, "side").is_err());
        assert!(rename_in(&dir, "feature/side", "bad..name").is_err());
        assert!(rename_in(&dir, "missing", "x").is_err());
        assert!(rename_in(&dir, "feature/side", "-f").is_err());

        // Unmerged commits need force; the checked-out branch can't go.
        assert!(delete_in(&dir, "feature/side", false).is_err());
        assert!(delete_in(&dir, "main", true).unwrap_err().contains("checked out"));
        delete_in(&dir, "feature/side", true).unwrap();
        assert!(require_branch(&dir, "feature/side").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn merges_rebases_and_squashes() {
        // Merge: a merge commit with both parents.
        let dir = diverged();
        merge_in(&dir, "side").unwrap();
        assert_eq!(git(&dir, &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
        let _ = std::fs::remove_dir_all(&dir);

        // Rebase: main's commit replayed on top of side, history stays linear.
        let dir = diverged();
        std::fs::write(dir.join("m.txt"), "dirty\n").unwrap();
        assert!(rebase_in(&dir, "side").unwrap_err().contains("Commit or stash"));
        git(&dir, &["checkout", "--", "m.txt"]);
        rebase_in(&dir, "side").unwrap();
        assert_eq!(count(&dir, "HEAD"), "4");
        assert_eq!(count(&dir, "side..HEAD"), "1");
        assert_eq!(git(&dir, &["rev-list", "--merges", "--count", "HEAD"]).trim(), "0");
        let _ = std::fs::remove_dir_all(&dir);

        // Squash: one ordinary commit with side's files; side is untouched.
        let dir = diverged();
        assert!(squash_in(&dir, "side", "").is_err());
        squash_in(&dir, "side", "Squash side").unwrap();
        assert_eq!(git(&dir, &["log", "-1", "--format=%s"]).trim(), "Squash side");
        assert_eq!(git(&dir, &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 2);
        assert!(dir.join("s1.txt").exists() && dir.join("s2.txt").exists());
        assert_eq!(count(&dir, "side"), "3");
        assert!(squash_in(&dir, "main", "Nothing").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebases_through_several_conflicting_steps() {
        use crate::conflicts::{conflicts_in, continue_in, Operation, RebaseStep};

        // main: m1 and m2 both change f.txt, m3 adds g.txt; side changes f.txt.
        let dir = new_repo("rebase-steps");
        commit_file(&dir, "f.txt", "base\n");
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit_file(&dir, "f.txt", "side\n");
        git(&dir, &["checkout", "-q", "main"]);
        commit_file(&dir, "f.txt", "m1\n");
        commit_file(&dir, "f.txt", "m2\n");
        commit_file(&dir, "g.txt", "g\n");

        rebase_in(&dir, "side").unwrap();
        let state = conflicts_in(&dir).unwrap();
        assert_eq!(state.operation, Some(Operation::Rebase));
        assert_eq!(state.step, Some(RebaseStep { current: 1, total: 3 }));

        // Step 1 resolved to side's text: nothing left to commit, so the
        // commit is dropped and the rebase moves on instead of failing.
        std::fs::write(dir.join("f.txt"), "side\n").unwrap();
        git(&dir, &["add", "f.txt"]);
        continue_in(&dir).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().step, Some(RebaseStep { current: 2, total: 3 }));

        // Step 2 resolved with a real change; step 3 applies by itself.
        std::fs::write(dir.join("f.txt"), "m2 on side\n").unwrap();
        git(&dir, &["add", "f.txt"]);
        continue_in(&dir).unwrap();
        let state = conflicts_in(&dir).unwrap();
        assert_eq!((state.operation, state.step), (None, None));
        assert_eq!(git(&dir, &["log", "--format=%s", "side..main"]), "g.txt\nf.txt\n");
        assert_eq!(git(&dir, &["show", "HEAD:f.txt"]), "m2 on side\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn squash_conflicts_go_to_the_conflict_editor() {
        use crate::conflicts::{abort_in, conflicts_in, continue_in, Operation};

        let dir = new_repo("squash-conflict");
        commit_file(&dir, "f.txt", "base\n");
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit_file(&dir, "f.txt", "side\n");
        let tip = git(&dir, &["rev-parse", "HEAD"]).trim().to_string();
        git(&dir, &["checkout", "-q", "main"]);
        commit_file(&dir, "f.txt", "main\n");

        squash_in(&dir, "side", "Squash side").unwrap();
        let state = conflicts_in(&dir).unwrap();
        assert_eq!(state.operation, Some(Operation::Squash));
        assert_eq!(state.message.as_deref(), Some("Squash side"));
        assert_eq!(state.incoming.as_deref(), Some("side"));
        assert_eq!(state.files.len(), 1);

        // Abort puts main back; doing it again and resolving commits it.
        abort_in(&dir).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().operation, None);
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");
        squash_in(&dir, "side", "Squash side").unwrap();
        std::fs::write(dir.join("f.txt"), "both\n").unwrap();
        git(&dir, &["add", "f.txt"]);
        continue_in(&dir).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().operation, None);
        assert_eq!(git(&dir, &["log", "-1", "--format=%s"]).trim(), "Squash side");
        assert_ne!(git(&dir, &["rev-parse", "HEAD^"]).trim(), tip);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
