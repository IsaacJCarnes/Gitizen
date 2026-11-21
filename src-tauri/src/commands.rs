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

/// Calls the commands through Tauri's real IPC layer (with a mock runtime),
/// so argument names, JSON shapes and errors match what the UI sees.
#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use serde_json::{json, Value};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::webview::InvokeRequest;
    use tauri::{WebviewWindow, WebviewWindowBuilder};

    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitizen-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| run_git(&dir, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.name", "Test"]);
        git(&["config", "user.email", "test@example.com"]);
        git(&["config", "core.autocrlf", "false"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-q", "-m", "First"]);
        git(&["mv", "a.txt", "b.txt"]);
        git(&["commit", "-q", "-m", "Rename", "-m", "Body line"]);
        git(&["branch", "other"]);
        dir
    }

    fn app_for(repo: &Path) -> WebviewWindow<MockRuntime> {
        let app = mock_builder()
            .manage(OpenRepository::default())
            .invoke_handler(tauri::generate_handler![
                status, log, branches, diff, commit_files, commit_diff, stage, unstage, commit,
                checkout,
            ])
            .build(mock_context(noop_assets()))
            .unwrap();
        tauri::Manager::state::<OpenRepository>(&app).open(repo.to_path_buf()).unwrap();
        WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap()
    }

    fn call(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    }

    #[test]
    fn commands_work_end_to_end() {
        let repo = temp_repo();
        let window = app_for(&repo);

        // History, refs and commit details.
        let log = call(&window, "log", json!({})).unwrap();
        assert_eq!(log[0]["message"], "Rename");
        assert_eq!(log[0]["body"], "Body line");
        assert_eq!(log[0]["refs"][0], json!({ "name": "main", "type": "branch", "current": true }));
        assert_eq!(log[0]["refs"][1], json!({ "name": "other", "type": "branch" }));
        assert_eq!(log[1]["parents"], json!([]));
        let head = log[0]["hash"].as_str().unwrap().to_string();
        let root = log[1]["hash"].as_str().unwrap().to_string();

        let files = call(&window, "commit_files", json!({ "hash": head })).unwrap();
        assert_eq!(files, json!([{ "path": "b.txt", "oldPath": "a.txt", "code": "R" }]));
        let root_files = call(&window, "commit_files", json!({ "hash": root })).unwrap();
        assert_eq!(root_files, json!([{ "path": "a.txt", "code": "A" }]));
        let root_diff =
            call(&window, "commit_diff", json!({ "hash": root, "path": "a.txt" })).unwrap();
        assert!(root_diff.as_str().unwrap().contains("+one"));
        let rename_diff = call(
            &window,
            "commit_diff",
            json!({ "hash": head, "path": "b.txt", "oldPath": "a.txt" }),
        )
        .unwrap();
        assert!(rename_diff.as_str().unwrap().contains("rename to b.txt"));
        assert!(call(&window, "commit_files", json!({ "hash": "HEAD~1" })).is_err());

        // Working tree: edit, stage, unstage, commit.
        std::fs::write(repo.join("b.txt"), "one\ntwo\n").unwrap();
        std::fs::write(repo.join("new file.txt"), "hi\n").unwrap();
        let status = call(&window, "status", json!({})).unwrap();
        assert_eq!(
            status,
            json!({ "branch": "main", "ahead": 0, "behind": 0, "files": [
                { "path": "b.txt", "staged": false, "code": "M" },
                { "path": "new file.txt", "staged": false, "code": "?" },
            ]})
        );
        let unstaged = call(&window, "diff", json!({ "path": "b.txt", "staged": false })).unwrap();
        assert!(unstaged.as_str().unwrap().contains("+two"));

        call(&window, "stage", json!({ "paths": ["b.txt"] })).unwrap();
        let staged = call(&window, "diff", json!({ "path": "b.txt", "staged": true })).unwrap();
        assert!(staged.as_str().unwrap().contains("+two"));
        call(&window, "unstage", json!({ "paths": ["b.txt"] })).unwrap();
        let status = call(&window, "status", json!({})).unwrap();
        assert_eq!(status["files"][0]["staged"], false);

        call(&window, "stage", json!({ "paths": ["b.txt", "new file.txt"] })).unwrap();
        call(&window, "commit", json!({ "message": "Second" })).unwrap();
        assert_eq!(call(&window, "status", json!({})).unwrap()["files"], json!([]));
        let error = call(&window, "commit", json!({ "message": "Nothing" })).unwrap_err();
        assert!(error.as_str().unwrap().contains("nothing"));

        // Branches and checkout.
        let branches = call(&window, "branches", json!({})).unwrap();
        assert_eq!(
            branches,
            json!([{ "name": "main", "current": true }, { "name": "other", "current": false }])
        );
        call(&window, "checkout", json!({ "branch": "other" })).unwrap();
        assert_eq!(call(&window, "status", json!({})).unwrap()["branch"], "other");
        assert!(call(&window, "checkout", json!({ "branch": "--orphan" })).is_err());

        let _ = std::fs::remove_dir_all(&repo);
    }
}
