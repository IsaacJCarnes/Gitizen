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

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::commands::{diff_options, run_diff};
use crate::conflicts::{conflicted_files, operation_in, Operation};
use crate::git::parsers::parse_name_status;
use crate::git::repository::{
    assert_branch_name, assert_hash, git_path, read_git_file, require_current_branch, Repo, EMPTY_TREE,
};
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
    /// The branch it was made on.
    pub branch: String,
    /// The commit the stash was made on (its first parent).
    pub base: String,
    /// Where the history graph attaches it: `base` while that commit is
    /// still on the branch, else the branch's tip (after the commit was
    /// undone or amended away), so the stash stays with its branch.
    pub anchor: String,
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

/// The note's name in the git folder.
const MARKER: &str = "gitizen-stash.json";

fn read_in_progress(dir: &Path) -> Option<InProgress> {
    serde_json::from_str(&read_git_file(dir, MARKER)?).ok()
}

fn write_in_progress(dir: &Path, state: &InProgress) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    std::fs::write(git_path(dir, MARKER)?, text).map_err(|error| error.to_string())
}

fn clear_in_progress(dir: &Path) -> Result<(), String> {
    let path = git_path(dir, MARKER)?;
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
    parse_subject(subject).filter(|(on, _)| on == branch).map(|(_, message)| message)
}

/// The branch a stash was made on and its message, from its reflog subject
/// ("On <branch>: <message>" or "WIP on <branch>: <hash> <subject>"). None
/// for stashes made on a detached HEAD and Gitizen's in-progress ones.
fn parse_subject(subject: &str) -> Option<(String, String)> {
    let rest = subject.strip_prefix("On ").or_else(|| subject.strip_prefix("WIP on "))?;
    // Branch names can't contain ':', so the first ": " ends the name.
    let (branch, message) = rest.split_once(": ")?;
    (branch != "(no branch)" && message != INTERNAL).then(|| (branch.to_string(), message.to_string()))
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
pub(crate) fn has_changes(dir: &Path, paths: &[String]) -> Result<bool, String> {
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
    require_current_branch(dir, "using its stash")
}

/// Every branch's stash (the newest one made on each branch), so the
/// history can show them all, not only the checked-out branch's.
pub(crate) fn stashes_in(dir: &Path) -> Result<Vec<BranchStash>, String> {
    // Like `stash_entries`, plus each stash's parents: the first is the
    // commit it was made on.
    let output = run_git(dir, ["stash", "list", "--format=%H%x00%P%x00%gs"])?;
    let mut seen = std::collections::HashSet::new();
    let mut stashes = Vec::new();
    for line in output.lines() {
        let mut fields = line.splitn(3, '\0');
        let (Some(hash), Some(parents), Some(subject)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let Some((branch, message)) = parse_subject(subject) else {
            continue;
        };
        // Newest first, so the first one seen is the branch's stash.
        if seen.insert(branch.clone()) {
            let base = parents.split_whitespace().next().unwrap_or_default().to_string();
            stashes.push(describe(dir, hash.to_string(), base, branch, message));
        }
    }
    Ok(stashes)
}

/// The current branch's stash, if it has one.
#[cfg(test)]
fn branch_stash_in(dir: &Path) -> Result<Option<BranchStash>, String> {
    use crate::git::repository::current_branch;
    // While adding to a stash, it is still the branch's (now being rebuilt).
    let branch = read_in_progress(dir).map(|state| state.branch).or_else(|| current_branch(dir));
    let Some(branch) = branch else {
        return Ok(None);
    };
    Ok(stashes_in(dir)?.into_iter().find(|stash| stash.branch == branch))
}

fn describe(dir: &Path, hash: String, base: String, branch: String, message: String) -> BranchStash {
    let anchor = anchor_for(dir, &base, &branch);
    BranchStash { files: stash_files(dir, &hash), hash, branch, base, anchor, message }
}

/// The files stash `hash` changes, untracked ones included. A stash commit
/// never changes, so each one's list is asked of git once and remembered
/// (every refresh shows every branch's stash).
fn stash_files(dir: &Path, hash: &str) -> Vec<CommitFile> {
    static KNOWN: OnceLock<Mutex<HashMap<String, Vec<CommitFile>>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Default::default);
    if let Some(files) = known.lock().ok().and_then(|known| known.get(hash).cloned()) {
        return files;
    }
    let output = run_git(dir, ["stash", "show", "--name-status", "-z", "--include-untracked", hash]);
    let files = parse_name_status(output.as_deref().unwrap_or_default());
    // A failure isn't remembered, so it is asked again next time.
    if let (Ok(_), Ok(mut known)) = (output, known.lock()) {
        known.insert(hash.to_string(), files.clone());
    }
    files
}

/// Where the graph attaches a stash made on `base` of `branch`: `base`
/// while the branch still contains it, else the branch's tip. A branch
/// that no longer exists leaves it on `base`.
fn anchor_for(dir: &Path, base: &str, branch: &str) -> String {
    let tip = format!("refs/heads/{branch}");
    // The usual case (the branch still has it) takes one git call.
    if run_git(dir, ["merge-base", "--is-ancestor", base, tip.as_str()]).is_ok() {
        return base.to_string();
    }
    run_git(dir, ["rev-parse", "--verify", "--quiet", &format!("{tip}^{{commit}}")])
        .map_or_else(|_| base.to_string(), |tip| tip.trim().to_string())
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
    run_diff(dir, args)
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

pub(crate) fn stash_in(dir: &Path, message: &str, paths: &[String]) -> Result<StashOutcome, String> {
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

/// Switches to `target` taking every uncommitted change along, for when git
/// won't carry them over itself because `target` changes the same files:
/// they are stashed, the branch is switched, and the stash is applied there
/// and dropped. If they conflict with `target`, it stops like popping a
/// stash ("conflicts"): finishing keeps the merged changes on `target`;
/// aborting leaves them in a stash on the branch they came from.
pub(crate) fn bring_in(dir: &Path, target: &str) -> Result<StashOutcome, String> {
    let source = branch_for_stash(dir)?;
    let stash = push(dir, &format!("Bringing changes to {target}"), &[])?;
    if let Err(error) = run_git(dir, ["checkout", target]) {
        // Still on the source branch: put the changes back.
        apply(dir, &stash, true)?;
        drop_stash_entry(dir, &stash)?;
        return Err(error);
    }
    match apply(dir, &stash, true) {
        Ok(()) => drop_stash_entry(dir, &stash).map(|()| StashOutcome::Done),
        Err(_) if !conflicted_files(dir)?.is_empty() => {
            let state = InProgress { kind: Kind::Pop, branch: target.into(), existing: stash, added: None, rest: None };
            write_in_progress(dir, &state)?;
            Ok(StashOutcome::Conflicts)
        }
        Err(error) => Err(format!(
            "Switched to {target}, but your changes couldn't be applied there, so they are kept as \
             {source}'s stash: {error}"
        )),
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
        // git refuses to apply over uncommitted changes to the same files.
        Err(_) if has_changes(dir, &[])? => pop_over_changes(dir, branch, existing),
        Err(error) => Err(error),
    }
}

/// Pops `existing` over uncommitted changes that touch the same files: sets
/// the changes aside, applies the stash to the clean working tree, then
/// merges the changes back in, where they may conflict with the stash (for
/// the conflict editor; `finish_in` or `abort_in` settle it).
fn pop_over_changes(dir: &Path, branch: String, existing: String) -> Result<StashOutcome, String> {
    let rest = push(dir, INTERNAL, &[])?;
    let state = InProgress { kind: Kind::Pop, branch, existing: existing.clone(), added: None, rest: Some(rest.clone()) };
    write_in_progress(dir, &state)?;
    // The stash goes in first (it fits HEAD), staged so the changes can
    // merge into it; then the changes on top.
    let merged = run_git(dir, ["stash", "apply", existing.as_str()])
        .and_then(|_| run_git(dir, ["add", "--all"]))
        .map_err(|error| (error, false))
        .and_then(|_| run_git(dir, ["stash", "apply", rest.as_str()]).map_err(|error| (error, true)));
    match merged {
        Ok(_) => finish_in(dir).map(|()| StashOutcome::Done),
        Err((_, true)) if !conflicted_files(dir)?.is_empty() => Ok(StashOutcome::Conflicts),
        Err((error, _)) => {
            // Put the stash and the changes back as they were.
            abort_in(dir)?;
            Err(error)
        }
    }
}

/// True while a stopped pop is merging uncommitted changes (set aside
/// first) back into the popped stash, rather than the stash into the branch.
pub(crate) fn pop_set_aside_changes(dir: &Path) -> bool {
    read_in_progress(dir).is_some_and(|state| state.kind == Kind::Pop && state.rest.is_some())
}

/// Throws a branch's stash away for good: `branch`'s, or the current
/// branch's when it is left out.
#[tauri::command]
pub async fn drop_stash(repo: Repo<'_>, branch: Option<String>) -> Result<(), String> {
    drop_in(&repo.require()?, branch.as_deref())
}

fn drop_in(dir: &Path, branch: Option<&str>) -> Result<(), String> {
    let branch = match branch {
        Some(branch) => {
            if let Some(operation) = operation_in(dir) {
                return Err(format!("Finish or abort the {} in progress first.", operation.git_name()));
            }
            assert_branch_name(branch)?.to_string()
        }
        None => branch_for_stash(dir)?,
    };
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
            // The changes set aside are merged back in already.
            if let Some(rest) = &state.rest {
                drop_stash_entry(dir, rest)?;
            }
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
        Kind::Pop if state.rest.is_some() => {
            // The changes were set aside before popping, so the working tree
            // can be emptied and they come back exactly as they were.
            run_git(dir, ["reset", "--hard", "-q"])?;
            run_git(dir, ["clean", "-fdq"])?;
            if let Some(rest) = &state.rest {
                apply(dir, rest, true)?;
                drop_stash_entry(dir, rest)?;
            }
        }
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
        drop_in(&dir, None).unwrap();
        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Done);
        assert_eq!(stash_count(&dir), 0);
        assert_eq!((read(&dir, "a.txt"), read(&dir, "b.txt"), read(&dir, "new.txt")), ("1\nA\n3\n".into(), "B\n".into(), "new\n".into()));
        assert!(pop_in(&dir).unwrap_err().contains("no stash"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_every_branch_stash_and_keeps_it_on_its_branch() {
        let dir = repo();
        std::fs::write(dir.join("a.txt"), "1\nmain\n3\n").unwrap();
        stash_in(&dir, "On main", &[]).unwrap();
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit_file(&dir, "c.txt", "c\n");
        std::fs::write(dir.join("b.txt"), "side\n").unwrap();
        stash_in(&dir, "On side", &[]).unwrap();

        // Both stashes are listed, each with its own branch.
        let stashes = stashes_in(&dir).unwrap();
        let mut found: Vec<_> = stashes.iter().map(|stash| (stash.branch.as_str(), stash.message.as_str())).collect();
        found.sort();
        assert_eq!(found, [("main", "On main"), ("side", "On side")]);
        let side_tip = git(&dir, &["rev-parse", "side"]).trim().to_string();
        let side = stashes.iter().find(|stash| stash.branch == "side").unwrap();
        assert_eq!((side.base.as_str(), side.anchor.as_str()), (side_tip.as_str(), side_tip.as_str()));

        // Undoing the commit it was made on: it moves to the branch's tip.
        git(&dir, &["reset", "-q", "--soft", "HEAD~1"]);
        git(&dir, &["commit", "-q", "-m", "Redone"]);
        let new_tip = git(&dir, &["rev-parse", "side"]).trim().to_string();
        let side = stashes_in(&dir).unwrap().into_iter().find(|stash| stash.branch == "side").unwrap();
        assert_eq!(side.base, side_tip);
        assert_eq!(side.anchor, new_tip);

        // Another branch's stash can be discarded without switching to it.
        drop_in(&dir, Some("main")).unwrap();
        assert_eq!(stashes_in(&dir).unwrap().len(), 1);
        assert!(drop_in(&dir, Some("main")).unwrap_err().contains("no stash"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pops_over_uncommitted_changes_to_the_same_file() {
        let dir = repo();
        commit_file(&dir, "long.txt", "1\n2\n3\n4\n5\n6\n7\n");
        std::fs::write(dir.join("long.txt"), "stashed\n2\n3\n4\n5\n6\n7\n").unwrap();
        stash_in(&dir, "Mine", &[]).unwrap();

        // Changes elsewhere in the same file merge without conflicts.
        std::fs::write(dir.join("long.txt"), "1\n2\n3\n4\n5\n6\nlocal\n").unwrap();
        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Done);
        assert_eq!(read(&dir, "long.txt"), "stashed\n2\n3\n4\n5\n6\nlocal\n");
        assert_eq!(stash_count(&dir), 0);
        assert_eq!(git(&dir, &["status", "--porcelain"]), " M long.txt\n");

        // The same line: stops for the conflict editor, labelled as the
        // stash and your changes. Abort puts both back.
        git(&dir, &["checkout", "-q", "--", "long.txt"]);
        std::fs::write(dir.join("a.txt"), "1\nstashed\n3\n").unwrap();
        stash_in(&dir, "Mine", &[]).unwrap();
        std::fs::write(dir.join("a.txt"), "1\nlocal\n3\n").unwrap();
        std::fs::write(dir.join("loose.txt"), "loose\n").unwrap();
        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Conflicts);
        assert_eq!(operation_in(&dir), Some(Operation::StashPop));
        assert!(pop_set_aside_changes(&dir));
        abort_in(&dir).unwrap();
        assert_eq!((read(&dir, "a.txt"), read(&dir, "loose.txt")), ("1\nlocal\n3\n".into(), "loose\n".into()));
        assert_eq!(stash_count(&dir), 1);

        // Resolving it: the stash is gone and the resolution is unstaged.
        assert_eq!(pop_in(&dir).unwrap(), StashOutcome::Conflicts);
        std::fs::write(dir.join("a.txt"), "1\nboth\n3\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        finish_in(&dir).unwrap();
        assert_eq!(stash_count(&dir), 0);
        assert_eq!(read(&dir, "a.txt"), "1\nboth\n3\n");
        assert!(dir.join("loose.txt").exists());
        assert!(git(&dir, &["diff", "--cached", "--name-only"]).trim().is_empty());

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
