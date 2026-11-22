//! Remotes and syncing: listing and adding remotes, publishing the
//! repository to GitHub, and fetch, pull and push for the current branch.
//!
//! Network commands can take a while, so they run on a blocking thread
//! (like the AI command) and the window keeps answering meanwhile. git never
//! prompts in a terminal (see `runner.rs`); credentials come from git's
//! credential helper, which on Windows is Git Credential Manager's own window.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;

use crate::git::repository::OpenRepository;
use crate::git::runner::run_git;

type Repo<'a> = State<'a, OpenRepository>;

/// A configured remote, e.g. `origin` and its fetch URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

/// Every remote with its URL, in the order git lists them.
#[tauri::command]
pub async fn remotes(repo: Repo<'_>) -> Result<Vec<Remote>, String> {
    Ok(remotes_in(&repo.require()?))
}

fn remotes_in(dir: &Path) -> Vec<Remote> {
    // Prints "remote.<name>.url <url>" per remote; exits 1 when there are
    // none, which is just an empty list.
    let output = run_git(dir, ["config", "--get-regexp", r"^remote\..*\.url$"]).unwrap_or_default();
    parse_remote_urls(&output)
}

/// Parses `git config --get-regexp` lines like "remote.origin.url <url>".
/// Remote names may contain dots, so the name is everything between the
/// "remote." prefix and the ".url" suffix of the key.
fn parse_remote_urls(output: &str) -> Vec<Remote> {
    output
        .lines()
        .filter_map(|line| {
            let (key, url) = line.split_once(' ')?;
            let name = key.strip_prefix("remote.")?.strip_suffix(".url")?;
            Some(Remote { name: name.to_string(), url: url.trim().to_string() })
        })
        .collect()
}

/// Adds a remote (normally `origin`) pointing at an existing repository URL.
#[tauri::command]
pub async fn add_remote(repo: Repo<'_>, name: String, url: String) -> Result<(), String> {
    add_remote_in(&repo.require()?, name.trim(), url.trim())
}

fn add_remote_in(dir: &Path, name: &str, url: &str) -> Result<(), String> {
    // Neither may look like an option, or git would read it as one.
    if name.is_empty() || name.starts_with('-') || name.contains(char::is_whitespace) {
        return Err("Enter a remote name without spaces, such as origin".into());
    }
    if url.is_empty() || url.starts_with('-') {
        return Err("Enter the URL of the remote repository".into());
    }
    run_git(dir, ["remote", "add", name, url]).map(drop)
}

/// Creates a new repository on GitHub with the GitHub CLI (`gh`), adds it as
/// `origin` and pushes the current branch to it. `gh` must be installed and
/// signed in (`gh auth login`); its own message is passed on otherwise.
#[tauri::command]
pub async fn publish_repository(
    repo: Repo<'_>,
    name: String,
    description: String,
    private: bool,
) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || publish_in(&dir, name.trim(), description.trim(), private)).await
}

fn publish_in(dir: &Path, name: &str, description: &str, private: bool) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') {
        return Err("Enter a name for the GitHub repository".into());
    }
    if remotes_in(dir).iter().any(|remote| remote.name == "origin") {
        return Err("This repository already has an origin remote".into());
    }
    let mut args = vec![
        "repo",
        "create",
        name,
        if private { "--private" } else { "--public" },
        "--source=.",
        "--remote=origin",
    ];
    // `--push` needs at least one commit; an empty repository is only created.
    if run_git(dir, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() {
        args.push("--push");
    }
    // `--description=<text>` keeps a description starting with "-" a value.
    let description_arg = format!("--description={description}");
    if !description.is_empty() {
        args.push(&description_arg);
    }
    run_gh(dir, &args)
}

/// Runs the GitHub CLI without letting it prompt, returning its message on
/// failure.
fn run_gh(dir: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("gh");
    command
        .current_dir(dir)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null());
    hide_console_window(&mut command);
    let output = command.output().map_err(|_| {
        "Publishing to GitHub needs the GitHub CLI. Install it from https://cli.github.com, run \
         `gh auth login` once, then try again. Or add an existing remote URL instead."
            .to_string()
    })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = if stderr.trim().is_empty() { stdout } else { stderr };
    Err(message.trim().to_string())
}

/// Downloads new commits from every remote (removing remote branches that
/// were deleted there), so the ahead/behind counts are current.
#[tauri::command]
pub async fn fetch(repo: Repo<'_>) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || run_git(&dir, ["fetch", "--all", "--prune"]).map(drop)).await
}

/// Pulls the current branch's upstream into it. Without a `pull.rebase`
/// setting this merges, as GitHub Desktop does; git's own settings win
/// otherwise.
#[tauri::command]
pub async fn pull(repo: Repo<'_>) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || pull_in(&dir)).await
}

fn pull_in(dir: &Path) -> Result<(), String> {
    current_branch(dir)?;
    if upstream_of(dir).is_none() {
        return Err("This branch isn't on the remote yet. Push it first.".into());
    }
    let mut args = vec!["pull", "--no-edit"];
    // Recent git refuses to pull diverged branches until told how; merge
    // unless the user already chose.
    if run_git(dir, ["config", "--get", "pull.rebase"]).is_err() {
        args.push("--no-rebase");
    }
    run_git(dir, args).map(drop)
}

/// Pushes the current branch. A branch with an upstream goes to it; a new
/// branch is published to `origin` (or the only remote) under its own name
/// and starts tracking it. Annotated tags on the pushed commits go along.
#[tauri::command]
pub async fn push(repo: Repo<'_>) -> Result<(), String> {
    let dir = repo.require()?;
    blocking(move || push_in(&dir)).await
}

fn push_in(dir: &Path) -> Result<(), String> {
    let branch = current_branch(dir)?;
    let local = format!("refs/heads/{branch}");
    if let Some((remote, merge)) = upstream_of(dir) {
        // Explicit "<local>:<upstream>" pushes to the tracked branch even
        // when its name differs, whatever `push.default` says.
        let refspec = format!("{local}:{merge}");
        return run_git(dir, ["push", "--follow-tags", remote.as_str(), refspec.as_str()]).map(drop);
    }
    let remote = default_remote(dir)
        .ok_or("This repository has no remote yet. Publish it or add a remote first.")?;
    // -u records the new remote branch as the upstream for later pulls and pushes.
    let refspec = format!("{local}:{local}");
    run_git(dir, ["push", "--follow-tags", "-u", remote.as_str(), refspec.as_str()]).map(drop)
}

/// The checked-out branch, or an error when HEAD is detached.
fn current_branch(dir: &Path) -> Result<String, String> {
    run_git(dir, ["symbolic-ref", "--short", "--quiet", "HEAD"])
        .map(|name| name.trim().to_string())
        .map_err(|_| "Check out a branch first. HEAD is detached.".to_string())
}

/// The current branch's upstream as (remote, "refs/heads/<branch>"), read
/// from `branch.<name>.remote` and `branch.<name>.merge`.
fn upstream_of(dir: &Path) -> Option<(String, String)> {
    let branch = current_branch(dir).ok()?;
    let config = |key: &str| {
        run_git(dir, ["config", "--get", &format!("branch.{branch}.{key}")])
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let remote = config("remote")?;
    // "." means the upstream is a local branch, which isn't a push target.
    (remote != ".").then_some((remote, config("merge")?))
}

/// `origin` if it exists, else the only remote, else none.
fn default_remote(dir: &Path) -> Option<String> {
    let remotes = remotes_in(dir);
    if remotes.iter().any(|remote| remote.name == "origin") {
        return Some("origin".into());
    }
    match remotes.as_slice() {
        [only] => Some(only.name.clone()),
        _ => None,
    }
}

/// Runs `work` on a blocking thread so a slow network call doesn't hold up
/// the async runtime's workers.
async fn blocking(work: impl FnOnce() -> Result<(), String> + Send + 'static) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitizen-remote-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        run_git(dir, args).unwrap()
    }

    fn new_repo(label: &str) -> PathBuf {
        let dir = temp_dir(label);
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        dir
    }

    fn commit_file(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
        git(dir, &["add", name]);
        git(dir, &["commit", "-q", "-m", name]);
    }

    #[test]
    fn parses_remote_names_with_dots() {
        let remotes = parse_remote_urls(
            "remote.origin.url https://github.com/a/b.git\nremote.my.fork.url git@github.com:c/d.git\n",
        );
        assert_eq!(
            remotes,
            vec![
                Remote { name: "origin".into(), url: "https://github.com/a/b.git".into() },
                Remote { name: "my.fork".into(), url: "git@github.com:c/d.git".into() },
            ]
        );
    }

    /// Two clones of one bare repository: publishing a branch, pushing,
    /// fetching and pulling between them.
    #[test]
    fn publishes_pushes_and_pulls_through_a_remote() {
        let server = temp_dir("server");
        git(&server, &["init", "-q", "--bare", "-b", "main"]);
        let server_url = server.to_string_lossy().into_owned();

        let alice = new_repo("alice");
        assert!(remotes_in(&alice).is_empty());
        commit_file(&alice, "a.txt", "one\n");
        let error = push_in(&alice).unwrap_err();
        assert!(error.contains("no remote"), "{error}");
        assert!(add_remote_in(&alice, "-x", &server_url).is_err());
        add_remote_in(&alice, "origin", &server_url).unwrap();
        assert_eq!(remotes_in(&alice)[0].name, "origin");
        assert!(pull_in(&alice).unwrap_err().contains("Push it first"));

        // First push publishes main and sets it as the upstream.
        push_in(&alice).unwrap();
        assert_eq!(upstream_of(&alice), Some(("origin".into(), "refs/heads/main".into())));

        let bob = temp_dir("bob");
        git(&bob, &["clone", "-q", &server_url, "."]);
        git(&bob, &["config", "user.name", "Bob"]);
        git(&bob, &["config", "user.email", "bob@example.com"]);
        commit_file(&bob, "b.txt", "two\n");
        push_in(&bob).unwrap();

        // Alice diverges, then pulls Bob's commit in with a merge.
        commit_file(&alice, "c.txt", "three\n");
        run_git(&alice, ["fetch", "--all", "--prune"]).unwrap();
        pull_in(&alice).unwrap();
        assert!(alice.join("b.txt").exists());
        let parents = git(&alice, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        assert_eq!(parents.split_whitespace().count(), 3, "pull should merge");
        push_in(&alice).unwrap();

        // Detached HEAD can't push.
        git(&alice, &["checkout", "-q", "--detach"]);
        assert!(push_in(&alice).unwrap_err().contains("detached"));

        for dir in [server, alice, bob] {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
