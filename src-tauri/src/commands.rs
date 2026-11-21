//! Tauri commands that expose git operations to the UI. Each command maps one
//! entry of `Command` in `shared/ipc.ts` to a git invocation on the open
//! repository; the UI calls them through `src/api/gitizen.ts`.
//!
//! Commands are `async` so Tauri runs them off the main thread and a slow git
//! call never freezes the window. Errors reach the UI as rejected promises
//! carrying git's message.

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::git::parsers::{parse_log, parse_name_status, parse_status, LOG_FORMAT};
use crate::git::repository::{assert_branch_name, assert_hash, first_parent_of, OpenRepository};
use crate::git::runner::run_git;
use crate::git::types::{CommitFile, GitBranch, GitCommit, GitStatus};

type Repo<'a> = State<'a, OpenRepository>;

/// Shows a folder picker and opens the chosen repository. Returns its path,
/// or None if the picker was cancelled.
#[tauri::command]
pub async fn open_repository(app: AppHandle, repo: Repo<'_>) -> Result<Option<String>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = folder.into_path().map_err(|error| error.to_string())?;
    repo.open(directory.clone())?;
    Ok(Some(directory.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn status(repo: Repo<'_>) -> Result<GitStatus, String> {
    let output = run_git(
        &repo.require()?,
        ["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"],
    )?;
    Ok(parse_status(&output))
}

/// Every branch, remote and tag (stashes excluded), newest first with
/// children always before parents, which is what the commit graph needs.
#[tauri::command]
pub async fn log(repo: Repo<'_>) -> Result<Vec<GitCommit>, String> {
    let format = format!("--format={LOG_FORMAT}");
    let output = run_git(
        &repo.require()?,
        [
            "log",
            "--decorate=full",
            "--exclude=refs/stash",
            "--all",
            "--date-order",
            "--max-count=500",
            &format,
        ],
    )?;
    Ok(parse_log(&output))
}

#[tauri::command]
pub async fn branches(repo: Repo<'_>) -> Result<Vec<GitBranch>, String> {
    let output = run_git(
        &repo.require()?,
        ["for-each-ref", "--format=%(HEAD)%(refname:short)", "refs/heads"],
    )?;
    Ok(output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            // %(HEAD) is "*" for the checked-out branch and " " otherwise.
            let (marker, name) = line.split_at(1);
            GitBranch { name: name.to_string(), current: marker == "*" }
        })
        .collect())
}

/// Diff of one working-tree file, either its staged or its unstaged changes.
#[tauri::command]
pub async fn diff(repo: Repo<'_>, path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path.as_str()]);
    run_git(&repo.require()?, args)
}

/// Files changed by a commit, compared to its first parent.
#[tauri::command]
pub async fn commit_files(repo: Repo<'_>, hash: String) -> Result<Vec<CommitFile>, String> {
    let dir = repo.require()?;
    let hash = assert_hash(&hash)?;
    let parent = first_parent_of(&dir, hash)?;
    let output = run_git(&dir, ["diff", "--name-status", "-z", "-M", parent.as_str(), hash])?;
    Ok(parse_name_status(&output))
}

/// Diff of one file in a commit, compared to its first parent. Renames pass
/// both paths so git shows them as a rename.
#[tauri::command]
pub async fn commit_diff(
    repo: Repo<'_>,
    hash: String,
    path: String,
    old_path: Option<String>,
) -> Result<String, String> {
    let dir = repo.require()?;
    let hash = assert_hash(&hash)?;
    let parent = first_parent_of(&dir, hash)?;
    let mut args = vec!["diff", "-M", parent.as_str(), hash, "--"];
    if let Some(old_path) = &old_path {
        args.push(old_path);
    }
    args.push(&path);
    run_git(&dir, args)
}

#[tauri::command]
pub async fn stage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_git(&repo.require()?, args).map(drop)
}

#[tauri::command]
pub async fn unstage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(paths);
    run_git(&repo.require()?, args).map(drop)
}

#[tauri::command]
pub async fn commit(repo: Repo<'_>, message: String) -> Result<(), String> {
    run_git(&repo.require()?, ["commit", "-m", &message]).map(drop)
}

#[tauri::command]
pub async fn checkout(repo: Repo<'_>, branch: String) -> Result<(), String> {
    let branch = assert_branch_name(&branch)?;
    run_git(&repo.require()?, ["checkout", branch]).map(drop)
}
