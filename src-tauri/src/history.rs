//! More history actions from the commit menu: reverting any commit,
//! resetting the current branch to an earlier commit, squashing a run of
//! commits into one, and deleting and pushing tags.
//!
//! Rewriting history (squashing) is only allowed where nothing else
//! can see the old commits: commits on the checked-out branch that no other
//! branch, tag or remote branch contains, and that aren't merges. Rewriting
//! those changes this branch alone, so nothing else in the repository (or
//! on the remote) is left pointing at history that no longer exists.

use std::path::Path;

use serde::Deserialize;

use crate::conflicts::{operation_in, unless_conflicted};
use crate::git::repository::{
    assert_hash, current_branch, first_parent_of, has_commits, require_clean,
    require_current_branch, Repo, EMPTY_TREE,
};
use crate::git::runner::{git_command, run_command_with_input, run_git};
use crate::remote::default_remote;
use crate::util::blocking;

/// The commits history may be rewritten for, newest first: the checked-out
/// branch's own commits, from its tip back along first parents until the
/// first one another branch, a tag or a remote branch also has, or the first
/// merge. Empty on a detached HEAD.
#[tauri::command]
pub async fn rewritable_commits(repo: Repo<'_>) -> Result<Vec<String>, String> {
    rewritable_in(&repo.require()?)
}

pub(crate) fn rewritable_in(dir: &Path) -> Result<Vec<String>, String> {
    let Some(branch) = current_branch(dir) else { return Ok(Vec::new()) };
    if !has_commits(dir) {
        return Ok(Vec::new());
    }
    // Every commit of HEAD's first-parent line that no other ref reaches.
    // `--exclude` only leaves this branch out of the `--branches` after it.
    let exclude = format!("--exclude={branch}");
    let output = run_git(
        dir,
        ["rev-list", "--first-parent", "--parents", "HEAD", "--not", exclude.as_str(), "--branches", "--tags", "--remotes"],
    )?;
    let mut hashes = Vec::new();
    for line in output.lines() {
        let mut words = line.split_whitespace();
        let Some(hash) = words.next() else { continue };
        if words.count() > 1 {
            break; // a merge
        }
        hashes.push(hash.to_string());
    }
    Ok(hashes)
}

/// Fails while a merge, rebase or the like is stopped, which `doing` would get mixed into.
fn require_no_operation(dir: &Path, doing: &str) -> Result<(), String> {
    match operation_in(dir) {
        Some(_) => Err(format!("Finish or abort the operation in progress before {doing}.")),
        None => Ok(()),
    }
}

/// The rewritable commits, failing with why when `wanted` aren't all among them.
fn require_rewritable(dir: &Path, wanted: &[String], doing: &str) -> Result<Vec<String>, String> {
    let branch = require_current_branch(dir, doing)?;
    require_no_operation(dir, doing)?;
    let rewritable = rewritable_in(dir)?;
    if wanted.iter().all(|hash| rewritable.contains(hash)) {
        Ok(rewritable)
    } else {
        Err(format!(
            "Only {branch}'s own commits can be rewritten: not merges, and not commits that are pushed \
             or that another branch or tag also has, since rewriting those would leave them behind."
        ))
    }
}

/// Adds a commit that undoes `hash` to the current branch (merges are
/// undone against their first parent). Stopping on conflicts succeeds,
/// leaving them to the conflict editor.
#[tauri::command]
pub async fn revert_commit(repo: Repo<'_>, hash: String) -> Result<(), String> {
    revert_in(&repo.require()?, &hash)
}

fn revert_in(dir: &Path, hash: &str) -> Result<(), String> {
    let hash = assert_hash(hash)?;
    require_current_branch(dir, "reverting")?;
    require_clean(dir, "reverting")?;
    let parents = run_git(dir, ["rev-list", "--parents", "-n", "1", hash])?.split_whitespace().count() - 1;
    let mut args = vec!["revert", "--no-edit"];
    if parents > 1 {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    unless_conflicted(dir, run_git(dir, args).map(drop))
}

/// How far `reset_to_commit` goes: "soft" keeps the changes of the commits
/// it drops staged, "mixed" keeps them unstaged, "hard" throws them (and any
/// uncommitted changes) away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// Moves the current branch back to `hash`, one of its earlier commits.
/// Only the checked-out branch moves: commits other branches, tags or the
/// remote have stay there.
#[tauri::command]
pub async fn reset_to_commit(repo: Repo<'_>, hash: String, mode: ResetMode) -> Result<(), String> {
    reset_in(&repo.require()?, &hash, mode)
}

fn reset_in(dir: &Path, hash: &str, mode: ResetMode) -> Result<(), String> {
    let hash = assert_hash(hash)?;
    let branch = require_current_branch(dir, "resetting")?;
    require_no_operation(dir, "resetting")?;
    if run_git(dir, ["merge-base", "--is-ancestor", hash, "HEAD"]).is_err() {
        return Err(format!("Only a commit {branch} already has (an earlier one) can be reset to."));
    }
    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    run_git(dir, ["reset", "-q", flag, hash]).map(drop)
}

/// Squashes `hashes` (a run of the branch's rewritable commits, next to each
/// other) into one commit with `message`, keeping the oldest's author. Later
/// commits are replayed on top; they apply exactly, since the squashed
/// commit has the same files as the newest one it replaces.
#[tauri::command]
pub async fn squash_commits(repo: Repo<'_>, hashes: Vec<String>, message: String) -> Result<(), String> {
    squash_in(&repo.require()?, &hashes, message.trim())
}

fn squash_in(dir: &Path, hashes: &[String], message: &str) -> Result<(), String> {
    if hashes.len() < 2 {
        return Err("Select at least two commits to squash.".into());
    }
    if message.is_empty() {
        return Err("Enter a commit message for the squashed commit.".into());
    }
    let rewritable = require_rewritable(dir, hashes, "squashing")?;
    require_clean(dir, "squashing")?;
    let mut positions: Vec<usize> =
        hashes.iter().filter_map(|hash| rewritable.iter().position(|each| each == hash)).collect();
    positions.sort_unstable();
    positions.dedup();
    let (newest, oldest) = (positions[0], positions[positions.len() - 1]);
    if positions.len() != hashes.len() || oldest - newest + 1 != positions.len() {
        return Err("Squash commits that are next to each other.".into());
    }
    let (newest, oldest) = (&rewritable[newest], &rewritable[oldest]);

    let tree = format!("{newest}^{{tree}}");
    let tree = run_git(dir, ["rev-parse", tree.as_str()])?.trim().to_string();
    let parent = first_parent_of(dir, oldest)?;
    let mut args = vec!["commit-tree", tree.as_str()];
    if parent != EMPTY_TREE {
        args.extend(["-p", parent.as_str()]);
    }
    args.extend(["-F", "-"]);
    // The oldest commit's author (and date) carry over, as in `git rebase -i`.
    let author = run_git(dir, ["log", "-1", "--format=%an%x00%ae%x00%aI", oldest.as_str()])?;
    let mut author = author.trim_end().split('\0');
    let mut command = git_command(dir, args);
    for key in ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE"] {
        command.env(key, author.next().unwrap_or_default());
    }
    let squashed = run_command_with_input(command, &format!("{message}\n"))?;
    let squashed = String::from_utf8_lossy(&squashed).trim().to_string();

    if newest == &rewritable[0] {
        // The squashed commit has HEAD's files, so the branch just moves to it.
        run_git(dir, ["reset", "-q", "--soft", squashed.as_str()]).map(drop)
    } else {
        // Replays the commits after the run (newest..HEAD) onto it.
        unless_conflicted(dir, run_git(dir, ["rebase", "--onto", squashed.as_str(), newest.as_str()]).map(drop))
    }
}

/// Rejects names that aren't an existing tag.
fn require_tag<'a>(dir: &Path, name: &'a str) -> Result<&'a str, String> {
    let full = format!("refs/tags/{name}");
    let exists = !name.is_empty()
        && !name.starts_with('-')
        && run_git(dir, ["show-ref", "--verify", "--quiet", full.as_str()]).is_ok();
    exists.then_some(name).ok_or_else(|| format!("There is no tag named {name}"))
}

/// The remote tags are pushed to and deleted from: `origin`, or the only remote.
fn tag_remote(dir: &Path) -> Result<String, String> {
    default_remote(dir).ok_or_else(|| "This repository has no remote to push tags to.".into())
}

/// Deletes tag `name`; with `from_remote`, from the remote too (first, so a
/// failure there leaves everything as it was).
#[tauri::command]
pub async fn delete_tag(repo: Repo<'_>, name: String, from_remote: bool) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || delete_tag_in(&dir, &name, from_remote)).await
}

fn delete_tag_in(dir: &Path, name: &str, from_remote: bool) -> Result<(), String> {
    let name = require_tag(dir, name)?;
    if from_remote {
        let remote = tag_remote(dir)?;
        let refspec = format!("refs/tags/{name}");
        run_git(dir, ["push", "--delete", remote.as_str(), refspec.as_str()])?;
    }
    run_git(dir, ["tag", "-d", name]).map(drop)
}

/// Pushes tag `name` to the remote.
#[tauri::command]
pub async fn push_tag(repo: Repo<'_>, name: String) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || push_tag_in(&dir, &name)).await
}

fn push_tag_in(dir: &Path, name: &str) -> Result<(), String> {
    let name = require_tag(dir, name)?;
    let remote = tag_remote(dir)?;
    let refspec = format!("refs/tags/{name}:refs/tags/{name}");
    run_git(dir, ["push", remote.as_str(), refspec.as_str()]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{commit_file, git, new_repo};
    use crate::util::unique_temp_dir;

    fn log(dir: &Path) -> String {
        git(dir, &["log", "--format=%s", "HEAD"])
    }

    fn rev(dir: &Path, spec: &str) -> String {
        git(dir, &["rev-parse", spec]).trim().to_string()
    }

    /// main: a, b, c, d (one file each); "other" branches off at b.
    fn repo() -> std::path::PathBuf {
        let dir = new_repo("history");
        for name in ["a.txt", "b.txt"] {
            commit_file(&dir, name, &format!("{name}\n"));
        }
        git(&dir, &["branch", "other"]);
        for name in ["c.txt", "d.txt"] {
            commit_file(&dir, name, &format!("{name}\n"));
        }
        dir
    }

    #[test]
    fn finds_the_commits_only_this_branch_has() {
        let dir = repo();
        let rewritable = rewritable_in(&dir).unwrap();
        assert_eq!(rewritable, vec![rev(&dir, "HEAD"), rev(&dir, "HEAD~1")]);
        // A tag shares a commit too.
        git(&dir, &["tag", "v1", "HEAD~1"]);
        assert_eq!(rewritable_in(&dir).unwrap(), vec![rev(&dir, "HEAD")]);
        // A detached HEAD has no branch to rewrite.
        git(&dir, &["checkout", "-q", "--detach"]);
        assert!(rewritable_in(&dir).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reverts_and_resets() {
        let dir = repo();
        revert_in(&dir, &rev(&dir, "HEAD~1")).unwrap();
        assert!(log(&dir).starts_with("Revert \"c.txt\""));
        assert!(!dir.join("c.txt").exists());

        // Soft keeps the dropped commits' changes staged (c added then
        // reverted, d added); hard drops them.
        reset_in(&dir, &rev(&dir, "HEAD~3"), ResetMode::Soft).unwrap();
        assert_eq!(log(&dir), "b.txt\na.txt\n");
        assert_eq!(git(&dir, &["status", "--porcelain"]), "A  d.txt\n");
        reset_in(&dir, &rev(&dir, "HEAD"), ResetMode::Hard).unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");

        // Only commits the branch has.
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit_file(&dir, "s.txt", "s\n");
        let side = rev(&dir, "HEAD");
        git(&dir, &["checkout", "-q", "main"]);
        assert!(reset_in(&dir, &side, ResetMode::Mixed).unwrap_err().contains("earlier"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn squashes_runs_of_unshared_commits() {
        let dir = repo();
        commit_file(&dir, "e.txt", "e\n");
        let (c, d, e) = (rev(&dir, "HEAD~2"), rev(&dir, "HEAD~1"), rev(&dir, "HEAD"));

        // c and d (not the tip): e is replayed on top.
        squash_in(&dir, &[d.clone(), c.clone()], "C and D").unwrap();
        assert_eq!(log(&dir), "e.txt\nC and D\nb.txt\na.txt\n");
        let squashed = git(&dir, &["show", "--name-only", "--format=", "HEAD~1"]);
        assert_eq!(squashed, "c.txt\nd.txt\n");
        assert_eq!(git(&dir, &["log", "-1", "--format=%an", "HEAD~1"]).trim(), "Test");

        // Not next to each other, shared with "other", or just one: refused.
        let now = rewritable_in(&dir).unwrap();
        assert!(squash_in(&dir, &[now[0].clone()], "x").is_err());
        let b = rev(&dir, "HEAD~2");
        assert!(squash_in(&dir, &[now[1].clone(), b], "x").unwrap_err().contains("own commits"));
        assert!(squash_in(&dir, &[e, d], "x").is_err(), "old hashes are gone");

        // Up to the tip: the branch just moves.
        squash_in(&dir, &now, "C, D and E").unwrap();
        assert_eq!(log(&dir), "C, D and E\nb.txt\na.txt\n");
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deletes_and_pushes_tags() {
        let server = unique_temp_dir("history-server").unwrap();
        git(&server, &["init", "-q", "--bare", "-b", "main"]);
        let dir = repo();
        git(&dir, &["remote", "add", "origin", &server.to_string_lossy()]);
        git(&dir, &["tag", "v1"]);

        assert!(require_tag(&dir, "--all").is_err());
        push_tag_in(&dir, "v1").unwrap();
        assert!(git(&server, &["tag"]).contains("v1"));
        delete_tag_in(&dir, "v1", true).unwrap();
        assert_eq!(git(&dir, &["tag"]), "");
        assert_eq!(git(&server, &["tag"]), "");
        assert!(delete_tag_in(&dir, "v1", false).is_err());

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&server);
    }
}
