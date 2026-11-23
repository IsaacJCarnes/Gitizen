//! Merge conflicts: what operation stopped (merge, squash merge,
//! cherry-pick, rebase or revert) and which files conflict, plus everything the conflict editor can
//! do about them: show both sides, save a resolution, ask the AI command for
//! one, open an external merge tool, take one side, mark a file resolved,
//! and continue or abort the operation.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::ai_commit::{run_shell_command, shell, AppSettings, MAX_DIFF_BYTES, TIMEOUT};
use crate::git::repository::{assert_hash, current_branch, Repo};
use crate::git::runner::{git_command, run_git, run_git_bytes};
use crate::util::{blocking, unique_temp_dir, write_keeping_line_endings};

/// An operation that is in progress because it stopped part way, usually
/// on a conflict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Merge,
    CherryPick,
    Rebase,
    Revert,
    /// `git merge --squash`: the branch's changes, waiting to be committed
    /// as one ordinary commit.
    Squash,
    /// Adding changes to the branch's stash, which conflicted with it.
    Stash,
    /// Popping the branch's stash, which conflicted with the branch.
    StashPop,
}

impl Operation {
    /// The git command that runs it, which also takes `--continue` and
    /// `--abort` (except a squash merge, handled separately).
    pub(crate) fn git_name(self) -> &'static str {
        match self {
            Operation::Merge | Operation::Squash => "merge",
            Operation::Stash | Operation::StashPop => "stash",
            Operation::CherryPick => "cherry-pick",
            Operation::Rebase => "rebase",
            Operation::Revert => "revert",
        }
    }
}

/// A file git couldn't merge by itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    /// git's two-letter unmerged status, e.g. "UU" (both changed), "AA"
    /// (both added), "UD" (deleted by them) or "DU" (deleted by us).
    pub code: String,
    /// True while the working-tree file still has `<<<<<<<` / `>>>>>>>`
    /// markers; false once a resolution was saved (or the file is gone).
    pub has_markers: bool,
}

/// The repository's conflict state. `operation` is None when nothing is in
/// progress; `files` lists only files still unresolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConflictState {
    pub operation: Option<Operation>,
    pub files: Vec<ConflictFile>,
    /// The commit message git prepared for the operation (e.g. "Merge
    /// branch 'side'"), without its comment lines; None if there is none.
    pub message: Option<String>,
    /// What is being brought in, e.g. "side" for `git merge side`: a branch
    /// pointing at it if there is one, else git's name for the commit
    /// ("side~2") or its short hash. None when nothing is in progress.
    pub incoming: Option<String>,
    /// The branch it is being brought into (for a rebase, the branch being
    /// rebased), or the short hash of a detached HEAD.
    pub current: Option<String>,
    /// For a rebase, which of its commits it is on, e.g. 2 of 3. None
    /// otherwise.
    pub step: Option<RebaseStep>,
}

/// How far a rebase has got: it is replaying commit `current` of `total`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RebaseStep {
    pub current: u32,
    pub total: u32,
}

/// The rebase's step, from the counters git keeps in its state folder
/// ("rebase-merge" for today's rebase, "rebase-apply" for the older one).
fn rebase_step(dir: &Path) -> Option<RebaseStep> {
    let number = |name: &str| -> Option<u32> {
        std::fs::read_to_string(git_file(dir, name)?).ok()?.trim().parse().ok()
    };
    let (current, total) = match (number("rebase-merge/msgnum"), number("rebase-merge/end")) {
        (Some(current), Some(total)) => (current, total),
        _ => (number("rebase-apply/next")?, number("rebase-apply/last")?),
    };
    Some(RebaseStep { current, total })
}

#[tauri::command]
pub async fn conflicts(repo: Repo<'_>) -> Result<ConflictState, String> {
    conflicts_in(&repo.require()?)
}

pub(crate) fn conflicts_in(dir: &Path) -> Result<ConflictState, String> {
    let files = conflicted_files(dir)?
        .into_iter()
        .map(|(path, code)| {
            let has_markers = std::fs::read(dir.join(&path))
                .map(|bytes| has_conflict_markers(&String::from_utf8_lossy(&bytes)))
                .unwrap_or(false);
            ConflictFile { path, code, has_markers }
        })
        .collect();
    let operation = operation_in(dir);
    let message = operation.and_then(|_| prepared_message(dir));
    let (incoming, current) = match operation {
        Some(operation) => branch_names(dir, operation),
        None => (None, None),
    };
    let step = (operation == Some(Operation::Rebase)).then(|| rebase_step(dir)).flatten();
    Ok(ConflictState { operation, files, message, incoming, current, step })
}

/// Where `name` (e.g. "MERGE_HEAD") is in the git folder. `--git-path`
/// resolves inside worktrees and custom git dirs too; the printed path is
/// relative to `dir` (or absolute), so it is joined on.
fn git_file(dir: &Path, name: &str) -> Option<PathBuf> {
    run_git(dir, ["rev-parse", "--git-path", name]).ok().map(|path| dir.join(path.trim()))
}

/// Names the incoming and current sides of a stopped operation.
fn branch_names(dir: &Path, operation: Operation) -> (Option<String>, Option<String>) {
    match operation {
        // The branch's stash merges into the changes being added to it, or
        // into the branch when popping.
        Operation::Stash => return (Some("stash".into()), Some("your changes".into())),
        Operation::StashPop => return (Some("stash".into()), current_branch(dir)),
        _ => {}
    }
    // The first line of a file in the git folder (e.g. MERGE_HEAD), trimmed.
    let read = |name: &str| {
        let text = std::fs::read_to_string(git_file(dir, name)?).ok()?;
        let first = text.lines().next()?.trim().to_string();
        (!first.is_empty()).then_some(first)
    };
    // A rebase keeps the branch being rebased and the commit it is replayed
    // onto in its state folder; HEAD itself is detached meanwhile.
    let rebase_file = |file: &str| read(&format!("rebase-merge/{file}")).or_else(|| read(&format!("rebase-apply/{file}")));
    let (incoming_hash, current) = match operation {
        Operation::Merge => (read("MERGE_HEAD"), None),
        Operation::CherryPick => (read("CHERRY_PICK_HEAD"), None),
        Operation::Revert => (read("REVERT_HEAD"), None),
        // SQUASH_MSG lists the squashed commits, newest (the branch tip) first.
        Operation::Squash => (squashed_tip(dir), None),
        Operation::Stash | Operation::StashPop => (None, None),
        Operation::Rebase => (
            rebase_file("onto"),
            rebase_file("head-name").map(|name| name.trim_start_matches("refs/heads/").to_string()),
        ),
    };
    // Otherwise the checked-out branch, or the short hash of a detached HEAD.
    let current = current.or_else(|| current_branch(dir)).or_else(|| {
        run_git(dir, ["rev-parse", "--short", "HEAD"]).ok().map(|hash| hash.trim().to_string())
    });
    let incoming = incoming_hash.map(|hash| commit_name(dir, &hash, current.as_deref()));
    (incoming, current)
}

/// The friendliest name for a commit: a branch (local, then remote) that
/// points at it other than `current`, else git's name relative to a branch
/// ("side~2"), else its short hash.
fn commit_name(dir: &Path, hash: &str, current: Option<&str>) -> String {
    let Ok(hash) = assert_hash(hash) else {
        return hash.to_string();
    };
    let pointing = run_git(
        dir,
        ["for-each-ref", "--points-at", hash, "--format=%(refname:short)", "refs/heads", "refs/remotes"],
    )
    .unwrap_or_default();
    if let Some(branch) = pointing
        .lines()
        .find(|name| Some(*name) != current && !name.ends_with("/HEAD"))
    {
        return branch.to_string();
    }
    run_git(dir, ["name-rev", "--name-only", "--no-undefined", "--exclude=refs/tags/*", hash])
        .map(|name| name.trim().trim_start_matches("remotes/").to_string())
        .unwrap_or_else(|_| hash.get(..7).unwrap_or(hash).to_string())
}

/// The newest commit a squash merge brings in, from the "commit <hash>"
/// lines git writes to SQUASH_MSG.
fn squashed_tip(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(git_file(dir, "SQUASH_MSG")?).ok()?;
    let hash = text.lines().find_map(|line| line.strip_prefix("commit "))?.trim();
    assert_hash(hash).ok().map(str::to_string)
}

/// `MERGE_MSG`, which merge, cherry-pick and revert write for the commit
/// that finishes them, minus git's "#" comment lines.
fn prepared_message(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(git_file(dir, "MERGE_MSG")?).ok()?;
    let message = text
        .lines()
        .filter(|line| !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    (!message.is_empty()).then_some(message)
}

/// Unmerged paths with their two-letter codes, from `git status`.
pub(crate) fn conflicted_files(dir: &Path) -> Result<Vec<(String, String)>, String> {
    let output = run_git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=no"])?;
    Ok(parse_unmerged(&output))
}

/// Picks the unmerged entries out of `git status --porcelain=v1 -z` output.
fn parse_unmerged(output: &str) -> Vec<(String, String)> {
    const UNMERGED: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
    let mut entries = output.split('\0').filter(|entry| !entry.is_empty());
    let mut files = Vec::new();
    while let Some(entry) = entries.next() {
        let (Some(code), Some(path)) = (entry.get(..2), entry.get(3..)) else {
            continue;
        };
        if UNMERGED.contains(&code) {
            files.push((path.to_string(), code.to_string()));
        } else if code.contains(['R', 'C']) {
            // A rename or copy is followed by its old path; skip it.
            entries.next();
        }
    }
    files
}

/// True if any line opens and any later line closes a conflict block. Both
/// are required so a lone line of "<" characters doesn't count.
fn has_conflict_markers(text: &str) -> bool {
    // One iterator for both searches, so the closing marker must come after
    // the opening one.
    let mut lines = text.lines();
    lines.any(|line| line.starts_with("<<<<<<<")) && lines.any(|line| line.starts_with(">>>>>>>"))
}

/// Which operation is in progress, from the marker files git keeps in the
/// git folder while one is stopped.
pub(crate) fn operation_in(dir: &Path) -> Option<Operation> {
    // Gitizen's own stash operations leave a note, checked first.
    if let Some(operation) = crate::stash::operation(dir) {
        return Some(operation);
    }
    let exists = |name: &str| git_file(dir, name).is_some_and(|path| path.exists());
    // A rebase replays commits as cherry-picks, so it is checked first.
    if exists("rebase-merge") || exists("rebase-apply") {
        Some(Operation::Rebase)
    } else if exists("MERGE_HEAD") {
        Some(Operation::Merge)
    } else if exists("CHERRY_PICK_HEAD") {
        Some(Operation::CherryPick)
    } else if exists("REVERT_HEAD") {
        Some(Operation::Revert)
    } else if exists("SQUASH_MSG") {
        // Left by `merge --squash` until the result is committed (or reset).
        Some(Operation::Squash)
    } else {
        None
    }
}

/// For operations that can stop on a conflict (pull, cherry-pick, continue):
/// stopping with unmerged files isn't a failure, since the conflict editor
/// takes over from there. Other errors pass through.
pub(crate) fn unless_conflicted(dir: &Path, result: Result<(), String>) -> Result<(), String> {
    match result {
        Err(_) if conflicted_files(dir).is_ok_and(|files| !files.is_empty()) => Ok(()),
        other => other,
    }
}

/// Fails unless `path` is a currently conflicted file, so the commands below
/// can't be pointed at arbitrary files.
fn require_conflicted(dir: &Path, path: &str) -> Result<PathBuf, String> {
    if conflicted_files(dir)?.iter().any(|(conflicted, _)| conflicted == path) {
        Ok(dir.join(path))
    } else {
        Err(format!("{path} isn't conflicted any more"))
    }
}

/// What the conflict editor shows for one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    /// Both sides merged by git, with each conflict between `<<<<<<< current`,
    /// `=======` and `>>>>>>> incoming` lines. Rebuilt from the index every
    /// time, so it stays available after a resolution has been saved.
    pub merged: String,
    /// The working-tree file as it is now (None if it doesn't exist), e.g. a
    /// resolution saved earlier.
    pub working: Option<String>,
    /// True when either side is binary; such files can only take one side.
    pub binary: bool,
}

#[tauri::command]
pub async fn conflict_versions(repo: Repo<'_>, path: String) -> Result<ConflictVersions, String> {
    versions_in(&repo.require()?, &path)
}

fn versions_in(dir: &Path, path: &str) -> Result<ConflictVersions, String> {
    let file = require_conflicted(dir, path)?;
    let working = std::fs::read(&file).ok();
    let (merged, binary) = merge_from_index(dir, path)?;
    let binary = binary || working.as_ref().is_some_and(|bytes| bytes.contains(&0));
    let working = if binary { None } else { working.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()) };
    Ok(ConflictVersions { merged: if binary { String::new() } else { merged }, working, binary })
}

/// Re-merges the three versions git keeps in the index for a conflicted file
/// (stage 1 the common base, 2 current, 3 incoming) with `git merge-file`,
/// returning the text with conflict markers and whether any side is binary.
/// A side that doesn't exist (an added or deleted file) merges as empty.
fn merge_from_index(dir: &Path, path: &str) -> Result<(String, bool), String> {
    // ":<n>:./<path>" names stage n of the path, relative to `dir`.
    let stage = |n: u8| run_git_bytes(dir, ["cat-file", "blob", &format!(":{n}:./{path}")]).unwrap_or_default();
    let (base, current, incoming) = (stage(1), stage(2), stage(3));
    if [&base, &current, &incoming].iter().any(|bytes| bytes.contains(&0)) {
        return Ok((String::new(), true));
    }

    // merge-file only reads files, so the three stages go to a temp folder.
    let temp = unique_temp_dir("merge")?;
    let write = |name: &str, bytes: &[u8]| -> Result<String, String> {
        let file = temp.join(name);
        std::fs::write(&file, bytes).map_err(|error| error.to_string())?;
        Ok(file.to_string_lossy().into_owned())
    };
    // A closure so `?` inside it can't skip removing the temp folder below.
    let result = (|| {
        let (current, base, incoming) =
            (write("current", &current)?, write("base", &base)?, write("incoming", &incoming)?);
        // -p prints the result instead of overwriting the first file; the -L
        // labels name the marker lines. merge-file exits with the number of
        // conflicts (so non-zero is normal) and negative only on errors.
        let output = git_command(
            dir,
            ["merge-file", "-p", "-L", "current", "-L", "base", "-L", "incoming", &current, &base, &incoming],
        )
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run git: {error}"))?;
        match output.status.code() {
            Some(code) if code >= 0 => Ok((String::from_utf8_lossy(&output.stdout).into_owned(), false)),
            _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        }
    })();
    let _ = std::fs::remove_dir_all(&temp);
    result
}

/// Writes the resolution the user built in the conflict editor to the file,
/// with the line endings the file already uses. It is not staged: "Mark
/// resolved" does that, so a saved file can still be changed.
#[tauri::command]
pub async fn save_conflict_resolution(repo: Repo<'_>, path: String, text: String) -> Result<(), String> {
    save_in(&repo.require()?, &path, &text)
}

fn save_in(dir: &Path, path: &str, text: &str) -> Result<(), String> {
    // The editor works in "\n"; a file checked out with CRLF keeps CRLF.
    write_keeping_line_endings(&require_conflicted(dir, path)?, text)
}

/// How to settle one conflicted file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Resolution {
    /// Keep the version from the branch you were on ("ours").
    Ours,
    /// Take the version being merged in ("theirs").
    Theirs,
    /// Keep the file as it is in the working tree (already edited or saved).
    AsIs,
}

/// Resolves one conflicted file and stages it, which tells git it's settled.
#[tauri::command]
pub async fn resolve_conflict(repo: Repo<'_>, path: String, resolution: Resolution) -> Result<(), String> {
    resolve_in(&repo.require()?, &path, resolution)
}

fn resolve_in(dir: &Path, path: &str, resolution: Resolution) -> Result<(), String> {
    let file = require_conflicted(dir, path)?;
    let side = match resolution {
        Resolution::Ours => Some("--ours"),
        Resolution::Theirs => Some("--theirs"),
        Resolution::AsIs => None,
    };
    if let Some(side) = side {
        // Fails when that side deleted the file; resolving to it means
        // deleting the file too.
        if run_git(dir, ["checkout", side, "--", path]).is_err() {
            return run_git(dir, ["rm", "--quiet", "--", path]).map(drop);
        }
    }
    if file.exists() {
        run_git(dir, ["add", "--", path]).map(drop)
    } else {
        // Deleted in the working tree: the resolution is the deletion.
        run_git(dir, ["rm", "--quiet", "--cached", "--", path]).map(drop)
    }
}

/// Finishes the stopped operation once every conflict is resolved: commits
/// the merge (with git's prepared message) or continues the cherry-pick,
/// rebase or revert. A rebase may stop again on the next commit's conflicts.
#[tauri::command]
pub async fn continue_operation(repo: Repo<'_>) -> Result<(), String> {
    continue_in(&repo.require()?)
}

pub(crate) fn continue_in(dir: &Path) -> Result<(), String> {
    if !conflicted_files(dir)?.is_empty() {
        return Err("Resolve every conflicted file first.".into());
    }
    let result = match operation_in(dir).ok_or("Nothing is in progress")? {
        // `merge --continue` would do the same, but needs git 2.12+.
        Operation::Merge => run_git(dir, ["commit", "--no-edit"]),
        // An ordinary commit. git would take SQUASH_MSG (the list of
        // squashed commits) over the message Gitizen kept in MERGE_MSG.
        Operation::Squash => {
            let message = prepared_message(dir).unwrap_or_else(|| "Squash merge".into());
            run_git(dir, ["commit", "-m", message.as_str()])
        }
        Operation::Stash | Operation::StashPop => return crate::stash::finish_in(dir),
        operation => run_git(dir, [operation.git_name(), "--continue"]),
    };
    unless_conflicted(dir, result.map(drop))
}

/// Abandons the stopped operation and puts everything back as it was before
/// it started.
#[tauri::command]
pub async fn abort_operation(repo: Repo<'_>) -> Result<(), String> {
    abort_in(&repo.require()?)
}

pub(crate) fn abort_in(dir: &Path) -> Result<(), String> {
    match operation_in(dir).ok_or("Nothing is in progress")? {
        // A squash merge has no MERGE_HEAD for `merge --abort`; this is what
        // that does, and it clears SQUASH_MSG too.
        Operation::Squash => run_git(dir, ["reset", "--merge"]).map(drop),
        Operation::Stash | Operation::StashPop => crate::stash::abort_in(dir),
        operation => run_git(dir, [operation.git_name(), "--abort"]).map(drop),
    }
}

const RESOLVE_PROMPT: &str = "The file below has git conflicts: each conflict is a block \
from a line starting with <<<<<<< to a line starting with >>>>>>>, with the current \
branch's version first, then =======, then the incoming version. Resolve every conflict, \
keeping the intent of both sides where they don't contradict. Reply with only the complete \
resolved file: no commentary, no code fences, and no conflict markers.";

/// The saved AI resolve command, or "" when none is set up. It is separate
/// from the commit message command, so each can use its own tool or model.
#[tauri::command]
pub async fn ai_resolve_command(app: AppHandle, state: State<'_, AppSettings>) -> Result<String, String> {
    Ok(state.read(&app)?.ai_resolve_command)
}

/// Saves the AI resolve command (trimmed; "" clears it) and returns what was saved.
#[tauri::command]
pub async fn set_ai_resolve_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
    command: String,
) -> Result<String, String> {
    let saved = state.update(&app, |settings| settings.ai_resolve_command = command.trim().to_string())?;
    Ok(saved.ai_resolve_command)
}

/// Asks the saved AI resolve command to resolve one conflicted file and returns its
/// answer. Nothing is written: the conflict editor shows it in the output
/// for review, and Save writes it.
#[tauri::command]
pub async fn ai_resolve_conflict(
    app: AppHandle,
    state: State<'_, AppSettings>,
    repo: Repo<'_>,
    path: String,
) -> Result<String, String> {
    let dir = repo.require()?;
    let command = state.ai_command(&app, |settings| settings.ai_resolve_command)?;
    // The AI can take minutes; other git calls keep answering meanwhile.
    blocking(move || ai_resolve_in(&dir, &path, &command)).await
}

fn ai_resolve_in(dir: &Path, path: &str, command: &str) -> Result<String, String> {
    let versions = versions_in(dir, path)?;
    if versions.binary {
        return Err(format!("{path} is a binary file; keep one side instead"));
    }
    if versions.merged.len() > MAX_DIFF_BYTES {
        return Err(format!("{path} is too large to send to the AI command"));
    }
    if !has_conflict_markers(&versions.merged) {
        return Err(format!("{path} has no conflicting lines to resolve"));
    }
    let operation = operation_in(dir).map_or("merge", Operation::git_name);
    let prompt = format!(
        "{RESOLVE_PROMPT}\n\nThe conflicts come from a {operation}.\n\nFile: {path}\n\n{}",
        versions.merged
    );
    let output = run_shell_command(dir, command, &prompt, TIMEOUT)?;
    clean_resolution(&output, versions.merged.ends_with('\n'))
}

/// Turns the AI's reply into file contents: drops one code fence wrapped
/// around the whole reply (but keeps fences that are part of the file),
/// refuses replies that are empty or still conflicted, and ends with a
/// newline when the file does.
fn clean_resolution(output: &str, final_newline: bool) -> Result<String, String> {
    let mut lines: Vec<&str> = output.lines().collect();
    // Trim blank lines at both ends so a fence can be spotted.
    while lines.first().is_some_and(|line| line.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    let fenced = lines.len() >= 2
        && lines[0].trim_start().starts_with("```")
        && lines[lines.len() - 1].trim() == "```";
    if fenced {
        lines = lines[1..lines.len() - 1].to_vec();
    }
    if lines.is_empty() {
        return Err("The AI command didn't print a resolved file".into());
    }
    // `lines()` already dropped any "\r"; saving restores the file's endings.
    let mut text = lines.join("\n");
    if has_conflict_markers(&text) {
        return Err("The AI's answer still had conflict markers".into());
    }
    if final_newline {
        text.push('\n');
    }
    Ok(text)
}

/// The external tool command for conflicted files, or "" when none is set.
#[tauri::command]
pub async fn editor_command(app: AppHandle, state: State<'_, AppSettings>) -> Result<String, String> {
    Ok(state.read(&app)?.editor_command)
}

/// Saves the external tool command (trimmed; "" falls back to git's merge
/// tool, or the system text editor).
#[tauri::command]
pub async fn set_editor_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
    command: String,
) -> Result<String, String> {
    let saved = state.update(&app, |settings| settings.editor_command = command.trim().to_string())?;
    Ok(saved.editor_command)
}

/// Which external tool `open_in_merge_tool` used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalTool {
    /// git's configured merge tool (`git mergetool`), which was waited for.
    /// It stages the file itself when it reports success.
    MergeTool,
    /// The command saved in Gitizen, or the system text editor; not waited for.
    Editor,
}

/// Opens a conflicted file outside Gitizen: in the command saved in Gitizen
/// if there is one, else in git's configured merge tool (`merge.tool`), else
/// in the system's plain text editor (Notepad on Windows).
#[tauri::command]
pub async fn open_in_merge_tool(
    app: AppHandle,
    state: State<'_, AppSettings>,
    repo: Repo<'_>,
    path: String,
) -> Result<ExternalTool, String> {
    let dir = repo.require()?;
    let file = require_conflicted(&dir, &path)?;
    let command = state.read(&app)?.editor_command;
    let merge_tool = run_git(&dir, ["config", "--get", "merge.tool"]).unwrap_or_default();
    if command.is_empty() && !merge_tool.trim().is_empty() {
        // The tool runs until its window is closed, so it is waited for on a
        // blocking thread. keepBackup=false stops it leaving "*.orig" files.
        return blocking(move || {
            let args = ["-c", "mergetool.keepBackup=false", "mergetool", "--no-prompt", "--", path.as_str()];
            run_git(&dir, args).map(|_| ExternalTool::MergeTool)
        })
        .await;
    }
    let mut editor = if command.is_empty() {
        default_editor(&file)
    } else {
        shell(&editor_command_line(&command, &file))
    };
    let mut child = editor
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not open an editor: {error}"))?;
    // Reap the process when it exits, without holding up this command.
    std::thread::spawn(move || child.wait());
    Ok(ExternalTool::Editor)
}

/// The saved command with the file's quoted path in place of `{file}`, or
/// appended when the command has no `{file}`.
fn editor_command_line(command: &str, file: &Path) -> String {
    let quoted = quote_path(file);
    if command.contains("{file}") {
        command.replace("{file}", &quoted)
    } else {
        format!("{command} {quoted}")
    }
}

/// Windows paths can't contain `"`, so plain double quotes are enough for `cmd`.
#[cfg(windows)]
fn quote_path(file: &Path) -> String {
    format!("\"{}\"", file.display())
}

/// Single quotes for `sh`, with any `'` in the path closed, escaped and reopened.
#[cfg(not(windows))]
fn quote_path(file: &Path) -> String {
    format!("'{}'", file.display().to_string().replace('\'', r"'\''"))
}

#[cfg(windows)]
fn default_editor(file: &Path) -> Command {
    let mut command = Command::new("notepad");
    command.arg(file);
    command
}

#[cfg(target_os = "macos")]
fn default_editor(file: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg("-t").arg(file);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn default_editor(file: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(file);
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{git, new_repo};

    /// A repository whose `main` and `side` branches both changed the middle
    /// line of `a.txt` (and `side` deleted `gone.txt`, which main edited).
    fn diverged_repo() -> PathBuf {
        let dir = new_repo("conflicts");
        let commit = |files: &[(&str, Option<&str>)], message: &str| {
            for (name, text) in files {
                match text {
                    Some(text) => std::fs::write(dir.join(name), text).unwrap(),
                    None => std::fs::remove_file(dir.join(name)).unwrap(),
                }
                git(&dir, &["add", "-A", "--", name]);
            }
            git(&dir, &["commit", "-q", "-m", message]);
        };
        commit(&[("a.txt", Some("top\nbase\nend\n")), ("gone.txt", Some("g\n"))], "Base");
        git(&dir, &["checkout", "-q", "-b", "side"]);
        commit(&[("a.txt", Some("top\ntheirs\nend\n")), ("gone.txt", None)], "Side");
        git(&dir, &["checkout", "-q", "main"]);
        commit(&[("a.txt", Some("top\nours\nend\n")), ("gone.txt", Some("g2\n"))], "Main");
        dir
    }

    const MERGED: &str = "top\n<<<<<<< current\nours\n=======\ntheirs\n>>>>>>> incoming\nend\n";

    #[test]
    fn parses_unmerged_entries_only() {
        let output = "UU a.txt\0M  b.txt\0R  new.txt\0old.txt\0UD gone.txt\0AA both.txt\0";
        assert_eq!(
            parse_unmerged(output),
            vec![
                ("a.txt".to_string(), "UU".to_string()),
                ("gone.txt".to_string(), "UD".to_string()),
                ("both.txt".to_string(), "AA".to_string()),
            ]
        );
    }

    #[test]
    fn cleans_ai_replies() {
        assert_eq!(clean_resolution("\n```text\na\nb\n```\n", true).unwrap(), "a\nb\n");
        // A fence inside the file stays.
        assert_eq!(clean_resolution("# Title\n```\ncode\n```\n", true).unwrap(), "# Title\n```\ncode\n```\n");
        assert_eq!(clean_resolution("a\r\nb\r\n", false).unwrap(), "a\nb");
        assert!(clean_resolution("  \n", true).is_err());
        assert!(clean_resolution(MERGED, true).unwrap_err().contains("still had"));
    }

    #[test]
    fn edits_saves_resolves_continues_and_aborts_a_merge() {
        let dir = diverged_repo();
        assert_eq!(
            conflicts_in(&dir).unwrap(),
            ConflictState { operation: None, files: vec![], message: None, incoming: None, current: None, step: None }
        );

        // The merge stops; `unless_conflicted` treats that as handled.
        let merge = run_git(&dir, ["merge", "--no-edit", "side"]).map(drop);
        assert!(merge.is_err());
        unless_conflicted(&dir, merge).unwrap();
        let state = conflicts_in(&dir).unwrap();
        assert_eq!(state.operation, Some(Operation::Merge));
        assert_eq!(state.message.as_deref(), Some("Merge branch 'side'"));
        assert_eq!((state.incoming.as_deref(), state.current.as_deref()), (Some("side"), Some("main")));
        assert_eq!(
            state.files,
            vec![
                ConflictFile { path: "a.txt".into(), code: "UU".into(), has_markers: true },
                ConflictFile { path: "gone.txt".into(), code: "UD".into(), has_markers: false },
            ]
        );
        assert!(continue_in(&dir).unwrap_err().contains("Resolve every"));
        assert!(resolve_in(&dir, "../elsewhere.txt", Resolution::AsIs).is_err());
        assert!(versions_in(&dir, "../elsewhere.txt").is_err());

        // Both sides come from the index, labelled current and incoming.
        let versions = versions_in(&dir, "a.txt").unwrap();
        assert_eq!(versions.merged, MERGED);
        assert!(versions.working.as_deref().unwrap().contains("<<<<<<<"));
        assert!(!versions.binary);
        // The deleted side merges as empty.
        assert!(versions_in(&dir, "gone.txt").unwrap().merged.contains("g2"));

        // A fake AI's answer comes back without touching the file.
        assert_eq!(ai_resolve_in(&dir, "a.txt", "echo merged").unwrap(), "merged\n");
        assert!(versions_in(&dir, "a.txt").unwrap().working.unwrap().contains("<<<<<<<"));
        assert!(ai_resolve_in(&dir, "a.txt", "exit 1").is_err());

        // Saving writes the file (unstaged); the merged view stays the same.
        save_in(&dir, "a.txt", "top\nours\ntheirs\nend\n").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "top\nours\ntheirs\nend\n");
        assert!(!conflicts_in(&dir).unwrap().files[0].has_markers);
        assert_eq!(versions_in(&dir, "a.txt").unwrap().merged, MERGED);

        // Mark a.txt resolved as saved; keep ours (main's edit) for the file side deleted.
        resolve_in(&dir, "a.txt", Resolution::AsIs).unwrap();
        assert!(save_in(&dir, "a.txt", "late\n").is_err());
        resolve_in(&dir, "gone.txt", Resolution::Ours).unwrap();
        assert!(conflicts_in(&dir).unwrap().files.is_empty());
        continue_in(&dir).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().operation, None);
        assert_eq!(git(&dir, &["rev-list", "--parents", "-n", "1", "HEAD"]).split_whitespace().count(), 3);
        assert_eq!(git(&dir, &["show", "HEAD:a.txt"]), "top\nours\ntheirs\nend\n");

        // Cherry-picking Side onto main again: conflicts, taking theirs
        // deletes gone.txt; then abort puts everything back.
        git(&dir, &["reset", "-q", "--hard", "HEAD~1"]);
        let pick = run_git(&dir, ["cherry-pick", "side"]).map(drop);
        unless_conflicted(&dir, pick).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().operation, Some(Operation::CherryPick));
        resolve_in(&dir, "gone.txt", Resolution::Theirs).unwrap();
        assert!(!dir.join("gone.txt").exists());
        abort_in(&dir).unwrap();
        assert_eq!(conflicts_in(&dir).unwrap().operation, None);
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "top\nours\nend\n");
        assert!(dir.join("gone.txt").exists());
        assert!(abort_in(&dir).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saving_keeps_crlf_files_crlf() {
        let dir = diverged_repo();
        let _ = run_git(&dir, ["merge", "--no-edit", "side"]);
        std::fs::write(dir.join("a.txt"), "<<<<<<< x\r\n>>>>>>> y\r\n").unwrap();
        save_in(&dir, "a.txt", "one\ntwo\n").unwrap();
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(), b"one\r\ntwo\r\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn editor_command_lines() {
        let file = Path::new("repo").join("a b.txt");
        let quoted = quote_path(&file);
        assert_eq!(editor_command_line("code --wait", &file), format!("code --wait {quoted}"));
        assert_eq!(editor_command_line("subl {file}:1", &file), format!("subl {quoted}:1"));
    }
}
