//! One stash per branch: stashing all changes or single files into it,
//! popping it back, or discarding it.
//!
//! Stashing while the branch already has a stash adds to that stash: both
//! sets of changes are merged in the working tree (where they may conflict,
//! to be resolved in the conflict editor) and saved again as one stash.
//! Popping a stash whose changes conflict with the branch stops the same
//! way. While either is stopped, a small JSON file in the git folder says
//! what was going on, so it can be finished or undone later, even after a
//! restart.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::diff_options;
use crate::conflicts::{conflicted_files, operation_in, Operation};
use crate::git::parsers::parse_name_status;
use crate::git::repository::{assert_hash, current_branch, Repo, EMPTY_TREE};
use crate::git::runner::run_git;
use crate::git::types::CommitFile;
use crate::util::file_in_repo;

/// The message (after "On <branch>: ") of stashes Gitizen makes for itself
/// while adding to a branch's stash. They never count as the branch's stash.
const INTERNAL: &str = "Gitizen (in progress, do not drop)";

/// What a stopped stash operation records, in `gitizen-stash.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InProgress {
    kind: Kind,
    /// The branch whose stash it is.
    branch: String,
    /// The branch's stash (its commit hash) being added to or popped.
    existing: String,
    /// Adding: the stash holding the changes being added.
    added: Option<String>,
    /// Adding: the stash holding the other changes, set aside meanwhile.
    rest: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    /// Adding changes to the branch's stash.
    Add,
    /// Popping the branch's stash.
    Pop,
}

/// What stashing or popping did: finished, or stopped on conflicts that
/// the conflict editor now shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StashOutcome {
    Done,
    Conflicts,
}

/// A branch's stash, as the sidebar shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BranchStash {
    pub hash: String,
    /// The commit the stash was made on (its first parent), where the
    /// history graph attaches it.
    pub base: String,
    /// The stash's message, without git's "On <branch>: " prefix.
    pub message: String,
    /// The files it changes, untracked ones included.
    pub files: Vec<CommitFile>,
}

/// Which stash operation is stopped, if any (for `conflicts::operation_in`).
pub(crate) fn operation(dir: &Path) -> Option<Operation> {
    read_in_progress(dir).map(|state| match state.kind {
        Kind::Add => Operation::Stash,
        Kind::Pop => Operation::StashPop,
    })
}

fn marker(dir: &Path) -> Result<PathBuf, String> {
    let path = run_git(dir, ["rev-parse", "--git-path", "gitizen-stash.json"])?;
    Ok(dir.join(path.trim()))
}

fn read_in_progress(dir: &Path) -> Option<InProgress> {
    let text = std::fs::read_to_string(marker(dir).ok()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_in_progress(dir: &Path, state: &InProgress) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    std::fs::write(marker(dir)?, text).map_err(|error| error.to_string())
}

fn clear_in_progress(dir: &Path) -> Result<(), String> {
    let path = marker(dir)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Every stash entry, newest (stash@{0}) first: its hash and reflog subject,
/// e.g. "On main: my message" or "WIP on main: abc123 Last commit".
fn stash_entries(dir: &Path) -> Result<Vec<(String, String)>, String> {
    let output = run_git(dir, ["stash", "list", "--format=%H%x00%gs"])?;
    Ok(output
        .lines()
        .filter_map(|line| line.split_once('\0'))
        .map(|(hash, subject)| (hash.to_string(), subject.to_string()))
        .collect())
}

/// The message of a stash made on `branch`, or None if it was made on
/// another branch (or is one of Gitizen's own in-progress stashes).
fn message_on(subject: &str, branch: &str) -> Option<String> {
    let message = subject
        .strip_prefix(&format!("On {branch}: "))
        .or_else(|| subject.strip_prefix(&format!("WIP on {branch}: ")))?;
    (message != INTERNAL).then(|| message.to_string())
}

/// The newest stash made on `branch`: its hash and message.
fn find_branch_stash(dir: &Path, branch: &str) -> Result<Option<(String, String)>, String> {
    Ok(stash_entries(dir)?
        .into_iter()
        .find_map(|(hash, subject)| message_on(&subject, branch).map(|message| (hash, message))))
}

/// Removes the stash entry whose commit is `hash` (by its current position,
/// which moves as other entries come and go).
fn drop_stash_entry(dir: &Path, hash: &str) -> Result<(), String> {
    let index = stash_entries(dir)?
        .iter()
        .position(|(entry, _)| entry == hash)
        .ok_or("That stash no longer exists")?;
    run_git(dir, ["stash", "drop", "-q", &format!("stash@{{{index}}}")]).map(drop)
}

/// True if git lists any change (untracked files included) to `paths`, or
/// anywhere when `paths` is empty.
fn has_changes(dir: &Path, paths: &[String]) -> Result<bool, String> {
    let mut args = vec!["status".to_string(), "--porcelain".into(), "--untracked-files=all".into(), "--".into()];
    args.extend(paths.iter().cloned());
    Ok(!run_git(dir, args)?.trim().is_empty())
}

/// Stashes `paths` (every change when empty), untracked files included,
/// and returns the new stash's hash.
fn push(dir: &Path, message: &str, paths: &[String]) -> Result<String, String> {
    // "--message=<m>" can't be read as an option even if it starts with "-".
    let mut args = vec!["stash".to_string(), "push".into(), "--include-untracked".into()];
    args.push(format!("--message={message}"));
    if !paths.is_empty() {
        args.push("--".into());
        args.extend(paths.iter().cloned());
    }
    run_git(dir, args)?;
    Ok(run_git(dir, ["rev-parse", "stash@{0}"])?.trim().to_string())
}

/// `git stash apply <hash>`, trying to restore what was staged too.
fn apply(dir: &Path, hash: &str, index: bool) -> Result<(), String> {
    if index && run_git(dir, ["stash", "apply", "-q", "--index", hash]).is_ok() {
        return Ok(());
    }
    run_git(dir, ["stash", "apply", "-q", hash]).map(drop)
}

/// The checked-out branch, refusing while another operation is stopped.
fn branch_for_stash(dir: &Path) -> Result<String, String> {
    if let Some(operation) = operation_in(dir) {
        return Err(format!("Finish or abort the {} in progress first.", operation.git_name()));
    }
    current_branch(dir).ok_or_else(|| "Check out a branch to use its stash.".to_string())
}

/// The current branch's stash, if it has one.
#[tauri::command]
pub async fn branch_stash(repo: Repo<'_>) -> Result<Option<BranchStash>, String> {
    branch_stash_in(&repo.require()?)
}

fn branch_stash_in(dir: &Path) -> Result<Option<BranchStash>, String> {
    // While adding to a stash, it is still the branch's (now being rebuilt).
    let branch = read_in_progress(dir).map(|state| state.branch).or_else(|| current_branch(dir));
    let Some(branch) = branch else {
        return Ok(None);
    };
    let Some((hash, message)) = find_branch_stash(dir, &branch)? else {
        return Ok(None);
    };
    let output = run_git(dir, ["stash", "show", "--name-status", "-z", "--include-untracked", hash.as_str()])
        .unwrap_or_default();
    let base = run_git(dir, ["rev-parse", &format!("{hash}^1")])?.trim().to_string();
    Ok(Some(BranchStash { hash, base, message, files: parse_name_status(&output) }))
}

/// The diff of one file in stash `hash`: against the commit it was made on,
/// or as a whole new file for an untracked file (kept in the stash's third
/// parent).
#[tauri::command]
pub async fn stash_diff(
    repo: Repo<'_>,
    hash: String,
    path: String,
    ignore_whitespace: Option<bool>,
) -> Result<String, String> {
    stash_diff_in(&repo.require()?, &hash, &path, ignore_whitespace)
}

fn stash_diff_in(dir: &Path, hash: &str, path: &str, ignore_whitespace: Option<bool>) -> Result<String, String> {
    let hash = assert_hash(hash)?;
    let untracked = format!("{hash}^3");
    let is_untracked = run_git(dir, ["ls-tree", "--name-only", untracked.as_str(), "--", path])
        .is_ok_and(|listed| !listed.trim().is_empty());
    let (from, to) = if is_untracked {
        (EMPTY_TREE.to_string(), untracked)
    } else {
        (format!("{hash}^1"), hash.to_string())
    };
    let mut args = diff_options(ignore_whitespace);
    args.extend([from.as_str(), to.as_str(), "--", path]);
    run_git(dir, args)
}

/// Stashes `paths` (all changes when empty) on the current branch. If the
/// branch has a stash already, the changes are added to it instead of
/// making a second one; that may stop on conflicts between the two, which
/// `finish_in` (after resolving) or `abort_in` then settle.
#[tauri::command]
pub async fn stash_changes(
    repo: Repo<'_>,
    message: String,
    paths: Option<Vec<String>>,
) -> Result<StashOutcome, String> {
    stash_in(&repo.require()?, message.trim(), &paths.unwrap_or_default())
}

fn stash_in(dir: &Path, message: &str, paths: &[String]) -> Result<StashOutcome, String> {
    let branch = branch_for_stash(dir)?;
    if !has_changes(dir, paths)? {
        return Err("There are no changes to stash.".into());
    }
    let Some((existing, _)) = find_branch_stash(dir, &branch)? else {
        let message = if message.is_empty() { "Stashed with Gitizen" } else { message };
        push(dir, message, paths)?;
        return Ok(StashOutcome::Done);
    };

    // Set the new changes aside, then everything else, leaving a clean
    // working tree to combine the two stashes in.
    let added = push(dir, INTERNAL, paths)?;
    let rest = if has_changes(dir, &[])? { Some(push(dir, INTERNAL, &[])?) } else { None };
    let state = InProgress { kind: Kind::Add, branch, existing: existing.clone(), added: Some(added.clone()), rest };
    write_in_progress(dir, &state)?;

    // The new changes go in first (they fit HEAD exactly), staged so the
    // stash can merge into them; then the existing stash on top.
    let combined = apply(dir, &added, false)
        .and_then(|()| run_git(dir, ["add", "--all"]).map(drop))
        .map_err(|error| (error, false))
        .and_then(|()| run_git(dir, ["stash", "apply", existing.as_str()]).map(drop).map_err(|error| (error, true)));
    match combined {
        Ok(()) => finish_in(dir).map(|()| StashOutcome::Done),
        Err((_, true)) if !conflicted_files(dir)?.is_empty() => Ok(StashOutcome::Conflicts),
        Err((error, _)) => {
            // Put everything back as it was before failing.
            abort_in(dir)?;
            Err(error)
        }
    }
}

/// Applies the current branch's stash and drops it. If its changes conflict
/// with the branch, stops with them for the conflict editor (the stash is
/// only dropped once they are resolved). Needs nothing staged, so stopping
/// can be undone without losing anything.
#[tauri::command]
pub async fn pop_stash(repo: Repo<'_>) -> Result<StashOutcome, String> {
    pop_in(&repo.require()?)
}

fn pop_in(dir: &Path) -> Result<StashOutcome, String> {
    let branch = branch_for_stash(dir)?;
    let (existing, _) = find_branch_stash(dir, &branch)?.ok_or_else(|| format!("{branch} has no stash."))?;
    if run_git(dir, ["diff", "--cached", "--quiet"]).is_err() {
        return Err("Commit or unstage your staged changes before popping the stash.".into());
    }
    match run_git(dir, ["stash", "apply", existing.as_str()]) {
        Ok(_) => drop_stash_entry(dir, &existing).map(|()| StashOutcome::Done),
        Err(_) if !conflicted_files(dir)?.is_empty() => {
            write_in_progress(dir, &InProgress { kind: Kind::Pop, branch, existing, added: None, rest: None })?;
            Ok(StashOutcome::Conflicts)
        }
        Err(error) => Err(error),
    }
}

/// Throws the current branch's stash away for good.
#[tauri::command]
pub async fn drop_stash(repo: Repo<'_>) -> Result<(), String> {
    drop_in(&repo.require()?)
}

fn drop_in(dir: &Path) -> Result<(), String> {
    let branch = branch_for_stash(dir)?;
    let (existing, _) = find_branch_stash(dir, &branch)?.ok_or_else(|| format!("{branch} has no stash."))?;
    drop_stash_entry(dir, &existing)
}

/// Finishes a stopped stash operation once its conflicts are resolved:
/// saves the combined stash (bringing back the changes set aside), or
/// drops the popped stash, leaving its changes unstaged.
pub(crate) fn finish_in(dir: &Path) -> Result<(), String> {
    let state = read_in_progress(dir).ok_or("No stash is in progress")?;
    if !conflicted_files(dir)?.is_empty() {
        return Err("Resolve every conflicted file first.".into());
    }
    match state.kind {
        Kind::Pop => {
            run_git(dir, ["reset", "-q"])?;
            drop_stash_entry(dir, &state.existing)?;
        }
        Kind::Add => {
            let message = stash_entries(dir)?
                .into_iter()
                .find(|(hash, _)| *hash == state.existing)
                .and_then(|(_, subject)| message_on(&subject, &state.branch))
                .unwrap_or_else(|| "Stashed with Gitizen".into());
            if has_changes(dir, &[])? {
                push(dir, &message, &[])?;
            }
            drop_stash_entry(dir, &state.existing)?;
            if let Some(added) = &state.added {
                drop_stash_entry(dir, added)?;
            }
            if let Some(rest) = &state.rest {
                apply(dir, rest, true)
                    .map_err(|error| format!("Your other changes are still in the stash list ({rest}): {error}"))?;
                drop_stash_entry(dir, rest)?;
            }
        }
    }
    clear_in_progress(dir)
}

/// Undoes a stopped stash operation: the branch's stash stays as it was,
/// and the working tree goes back to how it was before.
pub(crate) fn abort_in(dir: &Path) -> Result<(), String> {
    let state = read_in_progress(dir).ok_or("No stash is in progress")?;
    match state.kind {
        Kind::Pop => {
            // Puts back what the stash changed, keeping unstaged local edits.
            run_git(dir, ["reset", "--merge", "-q"])?;
            // Untracked files the stash brought back (its third parent).
            let untracked = format!("{}^3", assert_hash(&state.existing)?);
            let names = run_git(dir, ["ls-tree", "-r", "-z", "--name-only", untracked.as_str()]).unwrap_or_default();
            for name in names.split('\0').filter(|name| !name.is_empty()) {
                if let Ok(file) = file_in_repo(dir, name) {
                    let _ = std::fs::remove_file(file);
                }
            }
        }
        Kind::Add => {
            // Everything of the user's is in the two stashes set aside, so
            // the working tree can be emptied (ignored files are kept).
            run_git(dir, ["reset", "--hard", "-q"])?;
            run_git(dir, ["clean", "-fdq"])?;
            for hash in [&state.added, &state.rest].into_iter().flatten() {
                apply(dir, hash, true)?;
                drop_stash_entry(dir, hash)?;
            }
        }
    }
    clear_in_progress(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::util::test_support::{commit_file, git, new_repo};

    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap_or_default()
    }

    fn stash_count(dir: &Path) -> usize {
        stash_entries(dir).unwrap().len()
    }

    /// a.txt "1\n2\n3\n" and b.txt "b\n" on main.
    fn repo() -> std::path::PathBuf {
        let dir = new_repo("stash");
        commit_file(&dir, "a.txt", "1\n2\n3\n");
        commit_file(&dir, "b.txt", "b\n");
        dir
    }

    #[test]
    fn stashes_files_into_one_stash_per_branch() {
        let dir = repo();
        assert!(stash_in(&dir, "", &[]).unwrap_err().contains("no changes"));

        // Stash one file; the other change stays.
        std::fs::write(dir.join("a.txt"), "1\nA\n3\n").unwrap();
        std::fs::write(dir.join("b.txt"), "B\n").unwrap();
        assert_eq!(stash_in(&dir, "First", &["a.txt".into()]).unwrap(), StashOutcome::Done);
        assert_eq!(read(&dir, "a.txt"), "1\n2\n3\n");
        assert_eq!(read(&dir, "b.txt"), "B\n");
        let stash = branch_stash_in(&dir).unwrap().unwrap();
        assert_eq!(stash.message, "First");
        assert_eq!(stash.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), ["a.txt"]);
        assert_eq!(stash.base, git(&dir, &["rev-parse", "HEAD"]).trim());
        assert!(stash_diff_in(&dir, &stash.hash, "a.txt", None).unwrap().contains("-2
+A"));

        // Adding a new file and a staged edit: still one stash, holding all.
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();
        std::fs::write(dir.join("keep.txt"), "keep\n").unwrap();
        git(&dir, &["add", "b.txt"]);
        let paths = ["new.txt".to_string(), "b.txt".to_string()];
        assert_eq!(stash_in(&dir, "", &paths).unwrap(), StashOutcome::Done);
        assert_eq!(stash_count(&dir), 1);
        assert!(read_in_progress(&dir).is_none());
        let stash = branch_stash_in(&dir).unwrap().unwrap();
        assert_eq!(stash.message, "First");
        let mut files: Vec<_> = stash.files.iter().map(|file| file.path.clone()).collect();
        files.sort();
        assert_eq!(files, ["a.txt", "b.txt", "new.txt"]);
        // An untracked file shows as entirely new.
        assert!(stash_diff_in(&dir, &stash.hash, "new.txt", None).unwrap().contains("+new"));
        assert!(stash_diff_in(&dir, "HEAD", "a.txt", None).is_err());
        // The change that wasn't stashed is back, untracked as before.
        assert_eq!(git(&dir, &["status", "--porcelain"]), "?? keep.txt\n");

        // The newest stash made on the branch is its stash; other branches
        // don't see it. Popping brings everything back.
        git(&dir, &["stash", "push", "-q", "-u", "-m", "keep it"]);
        git(&dir, &["checkout", "-q", "-b", "other"]);
        assert!(branch_stash_in(&dir).unwrap().is_none());
        git(&dir, &["checkout", "-q", "main"]);
        assert_eq!(branch_stash_in(&dir).unwrap().unwrap().message, "keep it");
        drop_in(&dir).unwrap();
        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Done);
        assert_eq!(stash_count(&dir), 0);
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt"), read(&dir, "new.txt")), ("1\nA\n3\n".into(), "B\n".into(), "new\n".into()));
        assert!(pop_in(&dir).unwrap_err().contains("no stash"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn conflicting_additions_are_resolved_or_undone() {
        let dir = repo();
        std::fs::write(dir.join("a.txt"), "1\nstashed\n3\n").unwrap();
        stash_in(&dir, "Mine", &[]).unwrap();

        // The same line changed again: adding it conflicts.
        std::fs::write(dir.join("a.txt"), "1\nnew\n3\n").unwrap();
        std::fs::write(dir.join("b.txt"), "other\n").unwrap();
        std::fs::write(dir.join("loose.txt"), "loose\n").unwrap();
        assert_eq!(stash_in(&dir, "", &["a.txt".into()]).unwrap(), StashOutcome::Conflicts);
        assert_eq!(operation_in(&dir), Some(Operation::Stash));
        assert_eq!(conflicted_files(&dir).unwrap().len(), 1);
        assert!(stash_in(&dir, "", &[]).unwrap_err().contains("Finish or abort"));
        assert_eq!(branch_stash_in(&dir).unwrap().unwrap().message, "Mine");

        // Abort: the stash and every change are as they were.
        abort_in(&dir).unwrap();
        assert_eq!(operation_in(&dir), None);
        assert_eq!(stash_count(&dir), 1);
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt"), read(&dir, "loose.txt")), ("1\nnew\n3\n".into(), "other\n".into(), "loose\n".into()));

        // Again, resolving it: the stash holds the resolution.
        assert_eq!(stash_in(&dir, "", &["a.txt".into()]).unwrap(), StashOutcome::Conflicts);
        std::fs::write(dir.join("a.txt"), "1\nboth\n3\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        finish_in(&dir).unwrap();
        assert_eq!(operation_in(&dir), None);
        assert_eq!(stash_count(&dir), 1);
        assert_eq!(read(&dir, "a.txt"), "1\n2\n3\n");
        assert_eq!((read(&dir, "b.txt"), read(&dir, "loose.txt")), ("other\n".into(), "loose\n".into()));
        let stash = branch_stash_in(&dir).unwrap().unwrap();
        assert_eq!(git(&dir, &["show", &format!("{}:a.txt", stash.hash)]), "1\nboth\n3\n");
        assert_eq!(stash.message, "Mine");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn conflicting_pops_are_resolved_or_undone() {
        let dir = repo();
        std::fs::write(dir.join("a.txt"), "1\nstashed\n3\n").unwrap();
        std::fs::write(dir.join("untracked.txt"), "u\n").unwrap();
        stash_in(&dir, "Mine", &[]).unwrap();
        commit_file(&dir, "a.txt", "1\ncommitted\n3\n");
        std::fs::write(dir.join("b.txt"), "local\n").unwrap();

        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Conflicts);
        assert_eq!(operation_in(&dir), Some(Operation::StashPop));
        assert!(dir.join("untracked.txt").exists());
        abort_in(&dir).unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), " M b.txt\n");
        assert_eq!(stash_count(&dir), 1);

        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Conflicts);
        std::fs::write(dir.join("a.txt"), "1\nresolved\n3\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        finish_in(&dir).unwrap();
        assert_eq!(stash_count(&dir), 0);
        let mut status: Vec<_> = git(&dir, &["status", "--porcelain"]).lines().map(str::to_string).collect();
        status.sort();
        assert_eq!(status, [" M a.txt", " M b.txt", "?? untracked.txt"]);

        // Popping needs nothing staged.
        std::fs::write(dir.join("a.txt"), "x\n").unwrap();
        stash_in(&dir, "", &["a.txt".into()]).unwrap();
        git(&dir, &["add", "b.txt"]);
        assert!(pop_in(&dir).unwrap_err().contains("staged"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
