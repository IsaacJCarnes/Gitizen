//! Tauri commands that expose git operations to the UI. Each command maps one
//! entry of `Command` in `shared/ipc.ts` to a git invocation on the open
//! repository; the UI calls them through `src/api/gitizen.ts`.
//!
//! Commands are `async` so Tauri runs them off the main thread and a slow git
//! call never freezes the window. Errors reach the UI as rejected promises
//! carrying git's message.

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::git::parsers::{parse_log, parse_name_status, parse_status, LOG_FORMAT};
use crate::git::patch::{
    changed_line_numbers, index_content, stages_any_addition, staged_line_indices, STALE,
};
use crate::git::repository::{
    assert_branch_name, assert_hash, first_parent_of, init_repository as git_init, OpenError,
    OpenRepository, EMPTY_TREE,
};
use crate::git::runner::{run_git, run_git_bytes, run_git_with_input};
use crate::git::types::{CommitFile, FileDiff, GitBranch, GitCommit, GitStatus};

type Repo<'a> = State<'a, OpenRepository>;

/// Shows a folder picker and opens the chosen repository. Returns its path,
/// or None if the picker was cancelled. A folder that isn't a repository
/// fails with `OpenError::NotARepository` so the UI can offer `init_repository`.
#[tauri::command]
pub async fn open_repository(app: AppHandle, repo: Repo<'_>) -> Result<Option<String>, OpenError> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let directory = folder.into_path().map_err(|error| error.to_string())?;
    repo.open(directory.clone())?;
    Ok(Some(directory.to_string_lossy().into_owned()))
}

/// Opens the repository at `path` without a picker, e.g. one chosen from the
/// recent repositories list. Returns the path. Fails like `open_repository`
/// (so a folder that is no longer a repository can be re-initialised), or
/// with a plain failure if the folder is gone.
#[tauri::command]
pub async fn open_repository_at(repo: Repo<'_>, path: String) -> Result<String, OpenError> {
    let directory = PathBuf::from(&path);
    if !directory.is_dir() {
        return Err(format!("{path} no longer exists").into());
    }
    repo.open(directory)?;
    Ok(path)
}

/// Runs `git init` in `path` (a folder the user picked that isn't a
/// repository yet) and opens it. Returns the path.
#[tauri::command]
pub async fn init_repository(repo: Repo<'_>, path: String) -> Result<String, String> {
    let directory = PathBuf::from(&path);
    git_init(&directory)?;
    repo.open(directory)?;
    Ok(path)
}

#[tauri::command]
pub async fn status(repo: Repo<'_>) -> Result<GitStatus, String> {
    // -z: NUL-separated entries, so paths with spaces or quotes come through as is.
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

/// `git diff` options shared by every diff the UI shows: plain text, git's
/// own diff (no external tools) and the usual a/ b/ prefixes, so the output
/// can be parsed and turned back into a patch. `-w` hides whitespace changes.
fn diff_options(ignore_whitespace: Option<bool>) -> Vec<&'static str> {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"];
    if ignore_whitespace == Some(true) {
        args.push("--ignore-all-space");
    }
    args
}

/// Every uncommitted change to one file, staged and unstaged together,
/// compared to HEAD (or to nothing before the first commit), plus which of
/// its changed lines are staged. The diff text is the same whether or not
/// the file is staged. Untracked files show as entirely added.
#[tauri::command]
pub async fn file_diff(
    repo: Repo<'_>,
    path: String,
    ignore_whitespace: Option<bool>,
) -> Result<FileDiff, String> {
    file_diff_in(&repo.require()?, &path, ignore_whitespace)
}

fn file_diff_in(dir: &Path, path: &str, ignore_whitespace: Option<bool>) -> Result<FileDiff, String> {
    let diff = combined_diff(dir, path, ignore_whitespace)?;
    let staged_lines = staged_lines_of(dir, path, &diff)?;
    Ok(FileDiff { diff, staged_lines })
}

/// True if git reports `path` as untracked. git refuses paths outside the
/// repository here, so a file read after this can't leave the repository.
fn is_untracked(dir: &Path, path: &str) -> Result<bool, String> {
    let entry = run_git(
        dir,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", path],
    )?;
    Ok(entry.starts_with("??"))
}

/// HEAD, or git's empty tree before the first commit.
fn head_or_empty_tree(dir: &Path) -> &'static str {
    if run_git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() {
        "HEAD"
    } else {
        EMPTY_TREE
    }
}

/// The diff `file_diff` shows: HEAD to working tree for one file.
fn combined_diff(dir: &Path, path: &str, ignore_whitespace: Option<bool>) -> Result<String, String> {
    if is_untracked(dir, path)? {
        // Store the file as git would (line endings normalised), so the diff
        // matches what `git diff HEAD` prints once the file is staged.
        let (hash, contents) = worktree_blob(dir, path)?;
        return Ok(new_file_diff(path, &hash, &contents));
    }
    let mut args = diff_options(ignore_whitespace);
    args.extend([head_or_empty_tree(dir), "--", path]);
    run_git(dir, args)
}

/// Indices of the changed lines of `diff` (from `combined_diff`, whitespace
/// shown or hidden) that are in the index.
fn staged_lines_of(dir: &Path, path: &str, diff: &str) -> Result<Vec<usize>, String> {
    if is_untracked(dir, path)? {
        return Ok(Vec::new());
    }
    // -U0 diffs list only changed lines, with their line numbers in the hunk
    // headers. `--cached` is HEAD to index; without it, index to working tree.
    let zero_context = |cached: bool| {
        let mut args = diff_options(None);
        args.push("-U0");
        if cached {
            args.push("--cached");
        }
        args.extend(["--", path]);
        run_git(dir, args)
    };
    let (removed_in_index, _) = changed_line_numbers(&zero_context(true)?);
    let (_, added_in_worktree) = changed_line_numbers(&zero_context(false)?);
    Ok(staged_line_indices(diff, &removed_in_index, &added_in_worktree))
}

/// Unified diff that adds `contents` (whose blob hash is `hash`) as a new
/// file, matching what `git diff HEAD` prints once the file is staged. Used
/// for untracked files, which `git diff` doesn't show.
fn new_file_diff(path: &str, hash: &str, contents: &[u8]) -> String {
    let short = hash.get(..7).unwrap_or(hash);
    let mut diff =
        format!("diff --git a/{path} b/{path}\nnew file mode 100644\nindex 0000000..{short}\n");
    if contents.contains(&0) {
        diff.push_str(&format!("Binary files /dev/null and b/{path} differ\n"));
        return diff;
    }
    let text = String::from_utf8_lossy(contents);
    if text.is_empty() {
        return diff;
    }
    let lines: Vec<&str> = text.strip_suffix('\n').unwrap_or(&text).split('\n').collect();
    // git writes a one-line range as "+1" rather than "+1,1".
    let range = match lines.len() {
        1 => "1".to_string(),
        count => format!("1,{count}"),
    };
    // git ends a file header line with a tab when the path has a space.
    let tab = if path.contains(' ') { "\t" } else { "" };
    diff.push_str(&format!("--- /dev/null\n+++ b/{path}{tab}\n@@ -0,0 +{range} @@\n"));
    for line in &lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if !text.ends_with('\n') {
        diff.push_str("\\ No newline at end of file\n");
    }
    diff
}

/// Writes the working-tree file to git's object store (`hash-object -w`
/// applies the same filters as `git add`, e.g. CRLF to LF) and returns the
/// blob's hash and the stored bytes, which is what `git diff` compares.
fn worktree_blob(dir: &Path, path: &str) -> Result<(String, Vec<u8>), String> {
    let hash = run_git(dir, ["hash-object", "-w", "--", path])?.trim().to_string();
    let contents = run_git_bytes(dir, ["cat-file", "blob", &hash])?;
    Ok((hash, contents))
}

/// The new side of a file as `git diff` sees it, for showing the lines a
/// diff leaves out between hunks: the file at commit `hash`, or the
/// working-tree file (line endings normalised as in git's diff) when `hash`
/// is None. Empty when the file doesn't exist there.
#[tauri::command]
pub async fn file_text(repo: Repo<'_>, path: String, hash: Option<String>) -> Result<String, String> {
    file_text_in(&repo.require()?, &path, hash.as_deref())
}

fn file_text_in(dir: &Path, path: &str, hash: Option<&str>) -> Result<String, String> {
    let bytes = match hash {
        Some(hash) => {
            // "<commit>:<path>" names the file's blob in that commit; a file
            // missing from the commit just has no text.
            let spec = format!("{}:{path}", assert_hash(hash)?);
            run_git_bytes(dir, ["show", spec.as_str()]).unwrap_or_default()
        }
        None => {
            let file = dir.join(path);
            if !file.is_file() {
                return Ok(String::new());
            }
            // Only files inside the repository can be read.
            let inside = file
                .canonicalize()
                .and_then(|file| Ok(file.starts_with(dir.canonicalize()?)))
                .unwrap_or(false);
            if !inside {
                return Err(format!("{path} is outside the repository"));
            }
            worktree_blob(dir, path)?.1
        }
    };
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Files changed by a commit, compared to its first parent.
#[tauri::command]
pub async fn commit_files(repo: Repo<'_>, hash: String) -> Result<Vec<CommitFile>, String> {
    let dir = repo.require()?;
    let hash = assert_hash(&hash)?;
    let parent = first_parent_of(&dir, hash)?;
    // -M detects renames, so a moved file is one entry with both paths.
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
    ignore_whitespace: Option<bool>,
) -> Result<String, String> {
    let dir = repo.require()?;
    let hash = assert_hash(&hash)?;
    let parent = first_parent_of(&dir, hash)?;
    let mut args = diff_options(ignore_whitespace);
    args.extend(["-M", parent.as_str(), hash, "--"]);
    if let Some(old_path) = &old_path {
        args.push(old_path);
    }
    args.push(&path);
    run_git(&dir, args)
}

#[tauri::command]
pub async fn stage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    stage_in(&repo.require()?, paths)
}

fn stage_in(dir: &Path, paths: Vec<String>) -> Result<(), String> {
    // A path that is in neither the working tree nor the index (a staged
    // deletion, or the old half of a staged rename) has nothing left to
    // stage, and `git add` would fail on it with "pathspec did not match".
    let mut ls_files = vec!["ls-files".to_string(), "-z".into(), "--".into()];
    ls_files.extend(paths.iter().cloned());
    let output = run_git(dir, ls_files)?;
    let indexed: HashSet<&str> = output.split('\0').filter(|p| !p.is_empty()).collect();
    let paths: Vec<String> = paths
        .into_iter()
        .filter(|path| indexed.contains(path.as_str()) || dir.join(path).symlink_metadata().is_ok())
        .collect();
    if paths.is_empty() {
        return Ok(());
    }
    // "--" ends the options, so a path can never be read as one.
    let args = ["add", "--"].map(String::from).into_iter().chain(paths);
    run_git(dir, args).map(drop)
}

#[tauri::command]
pub async fn unstage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    let args = ["reset", "HEAD", "--"].map(String::from).into_iter().chain(paths);
    run_git(&repo.require()?, args).map(drop)
}

/// Stages (`staged` true) or unstages (`staged` false) single changed lines
/// of one file. `diff` is the diff `file_diff` returned with whitespace
/// shown, and `lines` are indices into its lines (split on "\n"). The index
/// is rewritten to HEAD plus exactly the staged lines. If the file changed
/// since the diff was shown, nothing is applied.
#[tauri::command]
pub async fn set_staged_lines(
    repo: Repo<'_>,
    path: String,
    diff: String,
    lines: Vec<usize>,
    staged: bool,
) -> Result<(), String> {
    set_staged_lines_in(&repo.require()?, &path, &diff, &lines, staged)
}

fn set_staged_lines_in(
    dir: &Path,
    path: &str,
    diff: &str,
    lines: &[usize],
    staged: bool,
) -> Result<(), String> {
    let current = combined_diff(dir, path, None)?;
    if current != diff {
        return Err(STALE.into());
    }
    let mut selected: HashSet<usize> = staged_lines_of(dir, path, &current)?.into_iter().collect();
    for line in lines {
        if staged {
            selected.insert(*line);
        } else {
            selected.remove(line);
        }
    }

    // "./" makes git read the path relative to `dir`, like every other path here.
    let head_spec = format!("HEAD:./{path}");
    let head = run_git(dir, ["show", head_spec.as_str()]).ok();
    let content = index_content(head.as_deref().unwrap_or(""), &current, &selected)?;
    let deleted = !dir.join(path).exists();
    // A new file with nothing staged, or a deletion with every line staged,
    // leaves no entry in the index at all.
    let remove = match &head {
        None => !stages_any_addition(&current, &selected),
        Some(_) => deleted && content.is_empty(),
    };
    if remove {
        return run_git(dir, ["update-index", "--force-remove", "--", path]).map(drop);
    }

    // Store the content as a blob (already normalised, so no filters) and point
    // the index entry at it. `--cacheinfo` takes "<mode>,<blob>,<path>" with
    // the path from the repository root, hence the folder prefix.
    let mode = file_mode(dir, path)?;
    let hash = run_git_with_input(dir, ["hash-object", "-w", "--no-filters", "--stdin"], &content)?;
    let prefix = run_git(dir, ["rev-parse", "--show-prefix"])?;
    let entry = format!("{mode},{},{}{path}", hash.trim(), prefix.trim());
    run_git(dir, ["update-index", "--add", "--cacheinfo", entry.as_str()]).map(drop)
}

/// The file's mode in the index, else in HEAD, else a plain file's.
fn file_mode(dir: &Path, path: &str) -> Result<String, String> {
    // Both print the mode as the first word, e.g. "100755 <hash> 0\tpath".
    let staged = run_git(dir, ["ls-files", "--stage", "--", path])?;
    let committed = run_git(dir, ["ls-tree", "HEAD", "--", path]).unwrap_or_default();
    let mode = [staged, committed]
        .iter()
        .find_map(|line| line.split_whitespace().next().map(str::to_string))
        .unwrap_or_else(|| "100644".to_string());
    Ok(mode)
}

/// Commits the staged changes. With `amend`, replaces the last commit
/// instead: its changes plus whatever is staged now, under `message` (so
/// amending with nothing staged just rewords it).
#[tauri::command]
pub async fn commit(repo: Repo<'_>, message: String, amend: Option<bool>) -> Result<(), String> {
    commit_in(&repo.require()?, &message, amend == Some(true))
}

fn commit_in(dir: &Path, message: &str, amend: bool) -> Result<(), String> {
    let mut args = vec!["commit", "-m", message];
    if amend {
        args.push("--amend");
    }
    run_git(dir, args).map(drop)
}

/// Saves every uncommitted change, untracked files included, to a new stash
/// and leaves the working tree clean, e.g. before switching branches.
/// `git stash pop` brings the changes back.
#[tauri::command]
pub async fn stash_changes(repo: Repo<'_>, message: String) -> Result<(), String> {
    stash_in(&repo.require()?, &message)
}

fn stash_in(dir: &Path, message: &str) -> Result<(), String> {
    // "-m=<message>" can't be read as an option even if the message starts with "-".
    let message = format!("--message={message}");
    run_git(dir, ["stash", "push", "--include-untracked", message.as_str()]).map(drop)
}

/// Undoes the last commit on the current branch, keeping its changes staged
/// so they can be edited and committed again. Merge commits are refused,
/// since undoing one would silently drop the merged branch.
#[tauri::command]
pub async fn undo_last_commit(repo: Repo<'_>) -> Result<(), String> {
    undo_last_commit_in(&repo.require()?)
}

fn undo_last_commit_in(dir: &Path) -> Result<(), String> {
    // "<head> <parent>..." : one word for a root commit, three or more for a merge.
    let line = run_git(dir, ["rev-list", "--parents", "-n", "1", "HEAD"])
        .map_err(|_| "There is no commit to undo".to_string())?;
    match line.split_whitespace().count() {
        // --soft moves the branch back but leaves the index (and files) alone.
        2 => run_git(dir, ["reset", "--soft", "HEAD~1"]).map(drop),
        // The first commit has no parent to reset to; deleting the branch ref
        // makes it unborn again, and the index still holds every file, staged.
        1 => {
            let head_ref = run_git(dir, ["symbolic-ref", "-q", "HEAD"])
                .map_err(|_| "Check out a branch to undo its first commit".to_string())?;
            run_git(dir, ["update-ref", "-d", head_ref.trim()]).map(drop)
        }
        _ => Err("Undoing a merge commit isn't supported".into()),
    }
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
                status, log, branches, file_diff, commit_files, commit_diff, stage, unstage, commit,
                checkout, set_staged_lines, undo_last_commit, stash_changes,
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

    /// The header checkbox over a staged rename: unstaging passes both
    /// halves, and staging skips the old path whose deletion is already in
    /// the index instead of failing on it.
    #[test]
    fn stages_and_unstages_both_halves_of_a_rename() {
        let repo = temp_repo();
        let porcelain = || run_git(&repo, ["status", "--porcelain"]).unwrap();
        run_git(&repo, ["mv", "b.txt", "c.txt"]).unwrap();
        let files = parse_status(&run_git(&repo, ["status", "--porcelain=v1", "-z"]).unwrap()).files;
        assert_eq!(files[0].old_path.as_deref(), Some("b.txt"));

        // Unstage all, as the UI sends it: the new path plus the old one.
        let both = vec!["c.txt".to_string(), "b.txt".to_string()];
        run_git(&repo, ["reset", "-q", "HEAD", "--", "c.txt", "b.txt"]).unwrap();
        assert_eq!(porcelain(), " D b.txt\n?? c.txt\n");

        // Stage all with the deletion of b.txt already staged on its own.
        run_git(&repo, ["rm", "-q", "--cached", "b.txt"]).unwrap();
        stage_in(&repo, both).unwrap();
        assert_eq!(porcelain(), "R  b.txt -> c.txt\n");
    }

    /// Line staging on the combined diff, through the plain functions (no
    /// IPC), so it also runs where the mock runtime can't.
    #[test]
    fn stages_single_lines_of_the_combined_diff() {
        let repo = temp_repo();
        let index_of = |diff: &str, line: &str| diff.split('\n').position(|l| l == line).unwrap();
        let show_index = || run_git(&repo, ["show", ":b.txt"]).unwrap();

        // b.txt holds "one"; add a line above and below it, then stage only "two".
        std::fs::write(repo.join("b.txt"), "zero\none\ntwo\n").unwrap();
        let first = file_diff_in(&repo, "b.txt", None).unwrap();
        assert!(first.staged_lines.is_empty());
        let two = index_of(&first.diff, "+two");
        set_staged_lines_in(&repo, "b.txt", &first.diff, &[two], true).unwrap();
        assert_eq!(show_index(), "one\ntwo\n");
        let after = file_diff_in(&repo, "b.txt", None).unwrap();
        assert_eq!(after.diff, first.diff, "staging must not change the diff");
        assert_eq!(after.staged_lines, vec![two]);

        // A request against an old diff is refused once the file changes.
        std::fs::write(repo.join("b.txt"), "zero\none\ntwo\nthree\n").unwrap();
        let error = set_staged_lines_in(&repo, "b.txt", &first.diff, &[two], false).unwrap_err();
        assert!(error.contains("changed since"));

        // Stage "zero" and "three", then unstage "two".
        let current = file_diff_in(&repo, "b.txt", None).unwrap();
        let (zero, two, three) = (
            index_of(&current.diff, "+zero"),
            index_of(&current.diff, "+two"),
            index_of(&current.diff, "+three"),
        );
        assert_eq!(current.staged_lines, vec![two]);
        set_staged_lines_in(&repo, "b.txt", &current.diff, &[zero, three], true).unwrap();
        set_staged_lines_in(&repo, "b.txt", &current.diff, &[two], false).unwrap();
        assert_eq!(show_index(), "zero\none\nthree\n");
        assert_eq!(file_diff_in(&repo, "b.txt", None).unwrap().staged_lines, vec![zero, three]);

        // Untracked file: same diff before and after staging part of it;
        // unstaging everything makes it untracked again.
        std::fs::write(repo.join("new.txt"), "a\nb\n").unwrap();
        let new = file_diff_in(&repo, "new.txt", None).unwrap();
        assert!(new.staged_lines.is_empty());
        let b = index_of(&new.diff, "+b");
        set_staged_lines_in(&repo, "new.txt", &new.diff, &[b], true).unwrap();
        assert_eq!(run_git(&repo, ["show", ":new.txt"]).unwrap(), "b\n");
        let partly = file_diff_in(&repo, "new.txt", None).unwrap();
        assert_eq!((partly.diff.as_str(), partly.staged_lines.clone()), (new.diff.as_str(), vec![b]));
        set_staged_lines_in(&repo, "new.txt", &new.diff, &[b], false).unwrap();
        assert!(is_untracked(&repo, "new.txt").unwrap());

        // Deleted file: staging every removed line stages the deletion.
        std::fs::remove_file(repo.join("b.txt")).unwrap();
        run_git(&repo, ["reset", "-q", "--", "b.txt"]).unwrap();
        let gone = file_diff_in(&repo, "b.txt", None).unwrap();
        let one = index_of(&gone.diff, "-one");
        set_staged_lines_in(&repo, "b.txt", &gone.diff, &[one], true).unwrap();
        let status = run_git(&repo, ["status", "--porcelain", "--", "b.txt"]).unwrap();
        assert_eq!(status.trim(), "D  b.txt");

        // The text used to expand hidden lines matches the diff's new side.
        std::fs::write(repo.join("crlf.txt"), "x\r\ny\r\n").unwrap();
        run_git(&repo, ["config", "core.autocrlf", "true"]).unwrap();
        assert_eq!(file_text_in(&repo, "crlf.txt", None).unwrap(), "x\ny\n");
        run_git(&repo, ["config", "core.autocrlf", "false"]).unwrap();
        assert_eq!(file_text_in(&repo, "missing.txt", None).unwrap(), "");
        std::fs::write(repo.join("../gitizen-outside.txt"), "secret\n").unwrap();
        assert!(file_text_in(&repo, "../gitizen-outside.txt", None).is_err());

        // Whitespace-only edits disappear when whitespace is hidden.
        run_git(&repo, ["reset", "-q", "--", "b.txt"]).unwrap();
        std::fs::write(repo.join("b.txt"), "  one\n").unwrap();
        let hidden = file_diff_in(&repo, "b.txt", Some(true)).unwrap();
        assert!(!hidden.diff.contains("@@"));
        assert!(file_diff_in(&repo, "b.txt", None).unwrap().diff.contains("+  one"));

        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn undoes_and_amends_the_last_commit() {
        let repo = temp_repo();
        let window = app_for(&repo);
        let subject = || run_git(&repo, ["log", "-1", "--format=%s"]).unwrap().trim().to_string();
        let porcelain = || run_git(&repo, ["status", "--porcelain"]).unwrap();

        // Undo "Rename": its rename comes back staged.
        call(&window, "undo_last_commit", json!({})).unwrap();
        assert_eq!(subject(), "First");
        assert_eq!(porcelain(), "R  a.txt -> b.txt\n");

        // Amend with nothing staged rewords; amend with a staged file adds it.
        call(&window, "commit", json!({ "message": "Rename again" })).unwrap();
        call(&window, "commit", json!({ "message": "Reworded", "amend": true })).unwrap();
        assert_eq!(subject(), "Reworded");
        std::fs::write(repo.join("extra.txt"), "x\n").unwrap();
        run_git(&repo, ["add", "extra.txt"]).unwrap();
        call(&window, "commit", json!({ "message": "Reworded", "amend": true })).unwrap();
        let files = run_git(&repo, ["show", "--name-only", "--format=", "HEAD"]).unwrap();
        assert!(files.contains("extra.txt") && files.contains("b.txt"), "{files}");
        assert_eq!(run_git(&repo, ["rev-list", "--count", "HEAD"]).unwrap().trim(), "2");

        // Stashing leaves a clean tree (untracked files too) for switching.
        std::fs::write(repo.join("b.txt"), "changed\n").unwrap();
        std::fs::write(repo.join("loose.txt"), "new\n").unwrap();
        call(&window, "stash_changes", json!({ "message": "Before switching" })).unwrap();
        assert_eq!(porcelain(), "");
        assert!(run_git(&repo, ["stash", "list"]).unwrap().contains("Before switching"));
        run_git(&repo, ["stash", "drop", "-q"]).unwrap();

        // Undoing the root commit leaves an unborn branch with everything staged.
        call(&window, "undo_last_commit", json!({})).unwrap();
        call(&window, "undo_last_commit", json!({})).unwrap();
        assert!(run_git(&repo, ["rev-parse", "--verify", "-q", "HEAD"]).is_err());
        assert!(porcelain().contains("A  b.txt"));
        assert!(call(&window, "undo_last_commit", json!({})).is_err());

        // Merge commits are refused.
        run_git(&repo, ["commit", "-q", "-m", "Root"]).unwrap();
        run_git(&repo, ["checkout", "-q", "-b", "side"]).unwrap();
        std::fs::write(repo.join("side.txt"), "s\n").unwrap();
        run_git(&repo, ["add", "side.txt"]).unwrap();
        run_git(&repo, ["commit", "-q", "-m", "Side"]).unwrap();
        run_git(&repo, ["checkout", "-q", "main"]).unwrap();
        std::fs::write(repo.join("main.txt"), "m\n").unwrap();
        run_git(&repo, ["add", "main.txt"]).unwrap();
        run_git(&repo, ["commit", "-q", "-m", "Main"]).unwrap();
        run_git(&repo, ["merge", "-q", "--no-edit", "side"]).unwrap();
        let error = call(&window, "undo_last_commit", json!({})).unwrap_err();
        assert!(error.as_str().unwrap().contains("merge"));

        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn open_repository_at_checks_the_folder() {
        let repo = temp_repo();
        let app = mock_builder()
            .manage(OpenRepository::default())
            .invoke_handler(tauri::generate_handler![open_repository_at, status])
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        let path = repo.to_string_lossy().into_owned();

        let missing = repo.join("missing").to_string_lossy().into_owned();
        let error = call(&window, "open_repository_at", json!({ "path": missing })).unwrap_err();
        assert_eq!(error["kind"], "failed");
        assert!(error["message"].as_str().unwrap().contains("no longer exists"));
        let not_repo = std::env::temp_dir().to_string_lossy().into_owned();
        let error = call(&window, "open_repository_at", json!({ "path": not_repo })).unwrap_err();
        assert_eq!(error["kind"], "notARepository");
        assert!(call(&window, "status", json!({})).is_err());

        let opened = call(&window, "open_repository_at", json!({ "path": path })).unwrap();
        assert_eq!(opened, json!(path));
        assert_eq!(call(&window, "status", json!({})).unwrap()["branch"], "main");

        let _ = std::fs::remove_dir_all(&repo);
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
        // file_diff reads the same before and after staging, untracked files included.
        let file_diff = |path: &str| call(&window, "file_diff", json!({ "path": path })).unwrap()["diff"].clone();
        let before = (file_diff("b.txt"), file_diff("new file.txt"));
        assert!(before.0.as_str().unwrap().contains("+two"));
        assert!(before.1.as_str().unwrap().contains("@@ -0,0 +1 @@\n+hi\n"));
        call(&window, "stage", json!({ "paths": ["b.txt", "new file.txt"] })).unwrap();
        assert_eq!((file_diff("b.txt"), file_diff("new file.txt")), before);
        call(&window, "unstage", json!({ "paths": ["b.txt", "new file.txt"] })).unwrap();

        call(&window, "stage", json!({ "paths": ["b.txt"] })).unwrap();
        let staged = call(&window, "file_diff", json!({ "path": "b.txt" })).unwrap();
        assert_eq!(staged["stagedLines"].as_array().unwrap().len(), 1);
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
