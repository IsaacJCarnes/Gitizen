//! The working tree and the commits the UI shows: diffs (of working-tree
//! files, commits and selections of commits), the text around them, staging
//! whole files or single lines, committing, undoing the last commit and
//! checking out a branch.
//!
//! Like every command module, commands are `async` so Tauri runs them off
//! the main thread and a slow git call never freezes the window. Errors
//! reach the UI as rejected promises carrying git's message.

use std::collections::HashSet;
use std::path::Path;
use crate::git::parsers::{head_is_unborn, parse_name_status};
use crate::git::patch::{
    changed_line_numbers, index_content, stages_any_addition, staged_line_indices, tidy_change_runs,
    STALE,
};
use crate::git::repository::{assert_branch_name, assert_hash, Repo, EMPTY_TREE};
use crate::git::runner::{run_git, run_git_bytes, run_git_with_input};
use crate::git::types::{CommitFile, FileDiff};
use crate::util::file_in_repo;

/// `git diff` options shared by every diff the UI shows: plain text, git's
/// own diff (no external tools) and the usual a/ b/ prefixes, so the output
/// can be parsed and turned back into a patch. `-w` hides whitespace changes.
pub(crate) fn diff_options(ignore_whitespace: Option<bool>) -> Vec<&'static str> {
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

pub(crate) fn file_diff_in(dir: &Path, path: &str, ignore_whitespace: Option<bool>) -> Result<FileDiff, String> {
    // The two -U0 diffs behind the staged lines run alongside the combined diff.
    let (combined, cached, worktree) = std::thread::scope(|scope| {
        let cached = scope.spawn(|| zero_context_diff(dir, path, true));
        let worktree = scope.spawn(|| zero_context_diff(dir, path, false));
        let combined = combined_diff(dir, path, ignore_whitespace);
        (combined, cached.join(), worktree.join())
    });
    let combined = combined?;
    let joined = |result: std::thread::Result<Result<String, String>>| {
        result.map_err(|_| "Loading the diff failed".to_string())?
    };
    let staged_lines = if combined.untracked {
        Vec::new()
    } else {
        staged_lines_from(&combined, &joined(cached)?, &joined(worktree)?)
    };
    Ok(FileDiff { diff: combined.diff, staged_lines })
}

/// The diff `file_diff` shows for one file, and whether the file is
/// untracked (known once, so the staged lines needn't ask git again).
pub(crate) struct CombinedDiff {
    pub diff: String,
    untracked: bool,
}

/// The diff `file_diff` shows: HEAD to working tree for one file.
pub(crate) fn combined_diff(dir: &Path, path: &str, ignore_whitespace: Option<bool>) -> Result<CombinedDiff, String> {
    let diff_against = |base: &str| {
        let mut args = diff_options(ignore_whitespace);
        args.extend([base, "--", path]);
        run_diff(dir, args)
    };
    // One `git status` of the path says both whether it is untracked and
    // whether HEAD has commits yet. The diff against HEAD, which is what is
    // nearly always needed, runs meanwhile. git refuses paths outside the
    // repository in both, and the file itself is only read after the status.
    let (output, against_head) = std::thread::scope(|scope| {
        let against_head = scope.spawn(|| diff_against("HEAD"));
        let output = run_git(dir, ["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all", "--", path]);
        (output, against_head.join())
    });
    let output = output?;
    let untracked = output.split('\0').nth(1).is_some_and(|entry| entry.starts_with("??"));
    if untracked {
        // Store the file as git would (line endings normalised), so the diff
        // matches what `git diff HEAD` prints once the file is staged.
        let (hash, contents) = worktree_blob(dir, path)?;
        return Ok(CombinedDiff { diff: new_file_diff(path, &hash, &contents), untracked });
    }
    // Before the first commit there is no HEAD: compare with git's empty tree.
    let diff = if head_is_unborn(&output) {
        diff_against(EMPTY_TREE)?
    } else {
        against_head.map_err(|_| "Loading the diff failed".to_string())??
    };
    Ok(CombinedDiff { diff, untracked })
}

/// Runs a `git diff` (built on `diff_options`) for the UI to show, with
/// unchanged lines git left among the changes made context again (see
/// `tidy_change_runs`).
pub(crate) fn run_diff<'a>(dir: &Path, args: impl IntoIterator<Item = &'a str>) -> Result<String, String> {
    run_git(dir, args).map(|diff| tidy_change_runs(&diff))
}

/// A -U0 diff of one file, which lists only changed lines with their line
/// numbers in the hunk headers. `cached`: HEAD to index; else index to
/// working tree.
fn zero_context_diff(dir: &Path, path: &str, cached: bool) -> Result<String, String> {
    let mut args = diff_options(None);
    args.push("-U0");
    if cached {
        args.push("--cached");
    }
    args.extend(["--", path]);
    run_git(dir, args)
}

/// Indices of the changed lines of `combined` (whitespace shown or hidden)
/// that are in the index.
pub(crate) fn staged_lines_of(dir: &Path, path: &str, combined: &CombinedDiff) -> Result<Vec<usize>, String> {
    if combined.untracked {
        return Ok(Vec::new());
    }
    let cached = zero_context_diff(dir, path, true)?;
    let worktree = zero_context_diff(dir, path, false)?;
    Ok(staged_lines_from(combined, &cached, &worktree))
}

/// `staged_lines_of`, given its two -U0 diffs.
fn staged_lines_from(combined: &CombinedDiff, cached: &str, worktree: &str) -> Vec<usize> {
    let (removed_in_index, _) = changed_line_numbers(cached);
    let (_, added_in_worktree) = changed_line_numbers(worktree);
    staged_line_indices(&combined.diff, &removed_in_index, &added_in_worktree)
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
            // Only files inside the repository can be read.
            if !file_in_repo(dir, path)?.is_file() {
                return Ok(String::new());
            }
            worktree_blob(dir, path)?.1
        }
    };
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Runs `diff` against what a commit's changes are compared to: the first
/// parent of `since` (a selection's oldest commit, so several commits show as
/// one change), or of `hash` itself when it is left out. The parent is
/// named "<commit>^" for git to resolve itself, with no git call of its own
/// to look it up; a root commit, which has none, is compared to git's empty
/// tree instead, on a second try.
fn against_base<T>(hash: &str, since: Option<&str>, diff: impl Fn(&str) -> Result<T, String>) -> Result<T, String> {
    let oldest = assert_hash(since.unwrap_or(hash))?;
    diff(&format!("{oldest}^")).or_else(|error| diff(EMPTY_TREE).map_err(|_| error))
}

/// Files changed by a commit, compared to its first parent; with `since`,
/// by every commit from `since` up to `hash` together.
#[tauri::command]
pub async fn commit_files(repo: Repo<'_>, hash: String, since: Option<String>) -> Result<Vec<CommitFile>, String> {
    commit_files_in(&repo.require()?, &hash, since.as_deref())
}

fn commit_files_in(dir: &Path, hash: &str, since: Option<&str>) -> Result<Vec<CommitFile>, String> {
    let hash = assert_hash(hash)?;
    // -M detects renames, so a moved file is one entry with both paths.
    let output = against_base(hash, since, |base| run_git(dir, ["diff", "--name-status", "-z", "-M", base, hash]))?;
    Ok(parse_name_status(&output))
}

/// Diff of one file in a commit, compared to its first parent (or, with
/// `since`, to the first parent of `since`). Renames pass both paths so git
/// shows them as a rename.
#[tauri::command]
pub async fn commit_diff(
    repo: Repo<'_>,
    hash: String,
    path: String,
    old_path: Option<String>,
    ignore_whitespace: Option<bool>,
    since: Option<String>,
) -> Result<String, String> {
    let dir = repo.require()?;
    let hash = assert_hash(&hash)?;
    against_base(hash, since.as_deref(), |base| {
        let mut args = diff_options(ignore_whitespace);
        args.extend(["-M", base, hash, "--"]);
        if let Some(old_path) = &old_path {
            args.push(old_path);
        }
        args.push(&path);
        run_diff(&dir, args)
    })
}

#[tauri::command]
pub async fn stage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    stage_in(&repo.require()?, paths)
}

fn stage_in(dir: &Path, paths: Vec<String>) -> Result<(), String> {
    // "--" ends the options, so a path can never be read as one.
    let add = |paths: Vec<String>| run_git(dir, ["add", "--"].map(String::from).into_iter().chain(paths)).map(drop);
    // Usually one `git add` does it. A path that is in neither the working
    // tree nor the index (a staged deletion, or the old half of a staged
    // rename) has nothing left to stage, and makes `git add` fail with
    // "pathspec did not match" before it adds anything; only after a failure
    // are such paths found and left out (any other failure comes back again).
    if add(paths.clone()).is_ok() {
        return Ok(());
    }
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
    add(paths)
}

#[tauri::command]
pub async fn unstage(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    unstage_in(&repo.require()?, paths)
}

fn unstage_in(dir: &Path, paths: Vec<String>) -> Result<(), String> {
    let args = ["reset", "HEAD", "--"].map(String::from).into_iter().chain(paths);
    run_git(dir, args).map(drop)
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
    let combined = combined_diff(dir, path, None)?;
    if combined.diff != diff {
        return Err(STALE.into());
    }
    let mut selected: HashSet<usize> = staged_lines_of(dir, path, &combined)?.into_iter().collect();
    for line in lines {
        if staged {
            selected.insert(*line);
        } else {
            selected.remove(line);
        }
    }

    write_index_lines(dir, path, &combined.diff, &selected)
}

/// The file's text in HEAD, or None when HEAD doesn't have it.
pub(crate) fn head_text(dir: &Path, path: &str) -> Option<String> {
    // "./" makes git read the path relative to `dir`, like every other path here.
    let head_spec = format!("HEAD:./{path}");
    run_git(dir, ["show", head_spec.as_str()]).ok()
}

/// Rewrites the index entry of `path` to HEAD plus exactly the `selected`
/// changed lines of `current`, its up-to-date combined diff.
pub(crate) fn write_index_lines(
    dir: &Path,
    path: &str,
    current: &str,
    selected: &HashSet<usize>,
) -> Result<(), String> {
    let head = head_text(dir, path);
    let content = index_content(head.as_deref().unwrap_or(""), current, selected)?;
    let deleted = !dir.join(path).exists();
    // A new file with nothing staged, or a deletion with every line staged,
    // leaves no entry in the index at all.
    let remove = match &head {
        None => !stages_any_addition(current, selected),
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
    use crate::git::parsers::parse_status;
    use crate::git::repository::OpenRepository;

    /// Commits "First" (a.txt) and "Rename" (a.txt moved to b.txt) on main,
    /// plus a branch "other" at the same commit.
    fn temp_repo() -> PathBuf {
        let dir = crate::util::test_support::new_repo("test");
        let git = |args: &[&str]| run_git(&dir, args).unwrap();
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
                crate::state::repository_state, file_diff, commit_files, commit_diff, stage, unstage, commit,
                checkout, set_staged_lines, undo_last_commit, crate::stash::stash_changes,
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

    /// One part of what `repository_state` returns, e.g. "status".
    fn part(window: &WebviewWindow<MockRuntime>, name: &str) -> Value {
        call(window, "repository_state", json!({})).unwrap()[name].clone()
    }

    /// How long one stage takes end to end, as the UI runs it: stage, the
    /// refresh after it, and reloading the open file's diff. Run with
    /// `cargo test --release time_a_stage -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn time_a_stage() {
        let repo = temp_repo();
        std::fs::write(repo.join("b.txt"), "one\ntwo\nthree\n").unwrap();
        let mut times = Vec::new();
        for round in 0..9 {
            let path = vec!["b.txt".to_string()];
            let start = std::time::Instant::now();
            if round % 2 == 0 {
                stage_in(&repo, path).unwrap();
            } else {
                unstage_in(&repo, path).unwrap();
            }
            let staged = start.elapsed();
            crate::state::working_in(&repo).unwrap();
            let refreshed = start.elapsed();
            file_diff_in(&repo, "b.txt", None).unwrap();
            times.push((staged, refreshed, start.elapsed()));
        }
        times.sort_by_key(|(_, _, total)| *total);
        let (staged, refreshed, total) = times[times.len() / 2];
        println!("median: staged {staged:?}, refreshed {refreshed:?}, diff loaded {total:?}");
        let _ = std::fs::remove_dir_all(&repo);
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
        assert!(combined_diff(&repo, "new.txt", None).unwrap().untracked);

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
        let outcome = call(&window, "stash_changes", json!({ "message": "Before switching" })).unwrap();
        assert_eq!(outcome, json!("done"));
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
            .invoke_handler(tauri::generate_handler![crate::open::open_repository_at, crate::state::repository_state])
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
        assert!(call(&window, "repository_state", json!({})).is_err());

        let opened = call(&window, "open_repository_at", json!({ "path": path })).unwrap();
        assert_eq!(opened, json!(path));
        assert_eq!(part(&window, "status")["branch"], "main");

        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn commands_work_end_to_end() {
        let repo = temp_repo();
        let window = app_for(&repo);

        // History, refs and commit details.
        let log = part(&window, "commits");
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
        // Both commits together: a.txt added and renamed is just b.txt added.
        let both = call(&window, "commit_files", json!({ "hash": head, "since": root })).unwrap();
        assert_eq!(both, json!([{ "path": "b.txt", "code": "A" }]));
        let both_diff = call(
            &window,
            "commit_diff",
            json!({ "hash": head, "path": "b.txt", "since": root }),
        )
        .unwrap();
        assert!(both_diff.as_str().unwrap().contains("new file mode"));
        assert!(call(&window, "commit_files", json!({ "hash": head, "since": "--all" })).is_err());

        // Working tree: edit, stage, unstage, commit.
        std::fs::write(repo.join("b.txt"), "one\ntwo\n").unwrap();
        std::fs::write(repo.join("new file.txt"), "hi\n").unwrap();
        let status = part(&window, "status");
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
        let status = part(&window, "status");
        assert_eq!(status["files"][0]["staged"], false);

        call(&window, "stage", json!({ "paths": ["b.txt", "new file.txt"] })).unwrap();
        call(&window, "commit", json!({ "message": "Second" })).unwrap();
        assert_eq!(part(&window, "status")["files"], json!([]));
        let error = call(&window, "commit", json!({ "message": "Nothing" })).unwrap_err();
        assert!(error.as_str().unwrap().contains("nothing"));

        // Branches and checkout.
        let branches = part(&window, "branches");
        assert_eq!(
            branches,
            json!([
                { "name": "main", "current": true, "ahead": 0, "behind": 0 },
                { "name": "other", "current": false, "ahead": 0, "behind": 1 },
            ])
        );
        call(&window, "checkout", json!({ "branch": "other" })).unwrap();
        assert_eq!(part(&window, "status")["branch"], "other");
        assert!(call(&window, "checkout", json!({ "branch": "--orphan" })).is_err());

        let _ = std::fs::remove_dir_all(&repo);
    }
}
