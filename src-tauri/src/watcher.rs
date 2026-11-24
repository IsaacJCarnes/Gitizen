//! Watches the open repository's files, so the UI refreshes by itself when
//! anything changes: edits in an editor, git commands in a terminal, other
//! tools. Changes arrive in bursts, so they are gathered until things go
//! quiet for a moment, and changes nobody would see (git's object store and
//! lock files, files `.gitignore` ignores) are left out. What is left is
//! sent to the window as a `repository-changed` event.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::git::repository::Repo;
use crate::git::runner::{run_git, run_git_with_input};

/// The event the window gets when the repository changed.
pub const CHANGED_EVENT: &str = "repository-changed";

/// How long the files must stay quiet before a burst of changes is reported.
const QUIET: Duration = Duration::from_millis(300);
/// The longest a busy burst (a build, a big checkout) waits before a report anyway.
const MAX_WAIT: Duration = Duration::from_secs(2);
/// More changed paths than this in one burst are reported without checking `.gitignore`.
const CHECK_LIMIT: usize = 500;

/// The watcher of the open repository, kept in Tauri's managed state.
/// Replacing it (another repository opened) stops the old one.
#[derive(Default)]
pub struct RepositoryWatcher(Mutex<Option<RecommendedWatcher>>);

/// Starts watching the open repository (stopping any earlier watch). The
/// window then gets `repository-changed` whenever something in it changes.
#[tauri::command]
pub async fn watch_repository(
    app: AppHandle,
    repo: Repo<'_>,
    watcher: tauri::State<'_, RepositoryWatcher>,
) -> Result<(), String> {
    let dir = repo.require()?;
    let watch = start(&dir, move || {
        let _ = app.emit(CHANGED_EVENT, ());
    })?;
    *watcher.0.lock().map_err(|_| "The file watcher is unavailable".to_string())? = Some(watch);
    Ok(())
}

/// The folders of a repository: its work tree and its git folder.
struct Folders {
    work_tree: PathBuf,
    git_dir: PathBuf,
}

/// Watches the repository at `dir`, calling `on_change` after each burst of
/// changes that matters. Watching stops when the returned watcher is dropped.
pub(crate) fn start(dir: &Path, on_change: impl Fn() + Send + 'static) -> Result<RecommendedWatcher, String> {
    let git_path = |flag: &str| run_git(dir, ["rev-parse", flag]).map(|path| PathBuf::from(path.trim()));
    let folders = Folders { work_tree: git_path("--show-toplevel")?, git_dir: git_path("--absolute-git-dir")? };

    let (sender, receiver) = channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            for path in event.paths {
                // Fails only once the watcher is gone; nothing to do then.
                let _ = sender.send(path);
            }
        }
    })
    .map_err(|error| format!("Couldn't watch the repository for changes: {error}"))?;
    watcher
        .watch(&folders.work_tree, RecursiveMode::Recursive)
        .map_err(|error| format!("Couldn't watch the repository for changes: {error}"))?;
    // A git folder outside the work tree (a linked worktree's) is watched too.
    if !folders.git_dir.starts_with(&folders.work_tree) {
        let _ = watcher.watch(&folders.git_dir, RecursiveMode::Recursive);
    }

    std::thread::spawn(move || report_bursts(&receiver, &folders, on_change));
    Ok(watcher)
}

/// Gathers changed paths into bursts and reports those that matter. Ends
/// when the watcher (the sending side) is dropped.
fn report_bursts(receiver: &Receiver<PathBuf>, folders: &Folders, on_change: impl Fn()) {
    while let Ok(first) = receiver.recv() {
        let mut paths = vec![first];
        let started = Instant::now();
        loop {
            match receiver.recv_timeout(QUIET) {
                Ok(path) => {
                    if paths.len() <= CHECK_LIMIT {
                        paths.push(path);
                    }
                    if started.elapsed() >= MAX_WAIT {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if matters(folders, &paths) {
            on_change();
        }
    }
}

/// True if any of `paths` is a change the UI shows: a file git doesn't
/// ignore, or git's own state (HEAD, the index, refs, a stopped merge...).
fn matters(folders: &Folders, paths: &[PathBuf]) -> bool {
    if paths.len() > CHECK_LIMIT {
        return true;
    }
    let mut work_files = Vec::new();
    for path in paths {
        if let Ok(inside) = path.strip_prefix(&folders.git_dir) {
            if git_state_changed(inside) {
                return true;
            }
        } else if let Ok(inside) = path.strip_prefix(&folders.work_tree) {
            if !inside.as_os_str().is_empty() {
                work_files.push(inside.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    !work_files.is_empty() && !all_ignored(&folders.work_tree, &work_files)
}

/// Whether a change at `inside` (a path in the git folder) changes anything
/// the UI shows. Objects and logs only change along with a ref, and lock
/// files come and go around every git command.
fn git_state_changed(inside: &Path) -> bool {
    let first = inside.components().next().map(|part| part.as_os_str().to_string_lossy().into_owned());
    let lock = inside.extension().is_some_and(|extension| extension == "lock");
    !lock && !matches!(first.as_deref(), Some("objects" | "logs" | "hooks" | "info" | "description"))
}

/// True if `.gitignore` (and the other exclude files) ignores every one of
/// `files` (paths relative to the work tree).
fn all_ignored(work_tree: &Path, files: &[String]) -> bool {
    let input: String = files.iter().map(|file| format!("{file}\0")).collect();
    // Lists the ignored ones; exits 1 when there are none.
    let ignored = run_git_with_input(work_tree, ["check-ignore", "-z", "--stdin"], &input).unwrap_or_default();
    let ignored: std::collections::HashSet<&str> = ignored.split('\0').filter(|path| !path.is_empty()).collect();
    files.iter().all(|file| ignored.contains(file.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{commit_file, git, new_repo};
    use std::sync::mpsc;

    fn folders(dir: &Path) -> Folders {
        let path = |flag: &str| PathBuf::from(git(dir, &["rev-parse", flag]).trim());
        Folders { work_tree: path("--show-toplevel"), git_dir: path("--absolute-git-dir") }
    }

    #[test]
    fn leaves_out_changes_nobody_sees() {
        let dir = new_repo("watch-filter");
        std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        let folders = folders(&dir);
        let work = |name: &str| folders.work_tree.join(name);
        let git_dir = |name: &str| folders.git_dir.join(name);

        assert!(matters(&folders, &[work("src/main.rs")]));
        assert!(!matters(&folders, &[work("target/debug/app.exe")]));
        assert!(matters(&folders, &[work("target/x"), work("notes.txt")]));
        assert!(matters(&folders, &[git_dir("HEAD")]));
        assert!(matters(&folders, &[git_dir("refs/heads/main")]));
        assert!(matters(&folders, &[git_dir("index")]));
        assert!(!matters(&folders, &[git_dir("objects/ab/cdef")]));
        assert!(!matters(&folders, &[git_dir("index.lock"), git_dir("logs/HEAD")]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_a_burst_of_changes_once() {
        let dir = new_repo("watch-events");
        commit_file(&dir, "a.txt", "a\n");
        let (sender, receiver) = mpsc::channel();
        let watcher = start(&dir, move || {
            let _ = sender.send(());
        })
        .unwrap();

        // Several writes close together are one report.
        for text in ["1", "2", "3"] {
            std::fs::write(dir.join("a.txt"), text).unwrap();
        }
        assert!(receiver.recv_timeout(Duration::from_secs(5)).is_ok(), "no report");
        assert!(receiver.recv_timeout(Duration::from_millis(800)).is_err(), "reported twice");

        // A commit made outside Gitizen is noticed too.
        git(&dir, &["commit", "-qam", "outside"]);
        assert!(receiver.recv_timeout(Duration::from_secs(5)).is_ok(), "commit not noticed");

        drop(watcher);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
