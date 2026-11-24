//! Actions on any commit in the history, from its right-click menu:
//! checking it out, starting a branch or tag there, cherry-picking it onto a
//! branch, and opening it on GitHub.

use std::path::Path;
use std::process::Command;

use crate::conflicts::unless_conflicted;
use crate::git::repository::{
    assert_branch_name, assert_hash, assert_new_branch_name, current_branch, require_clean, Repo,
};
use crate::git::runner::run_git;

/// Checks out the commit itself (a detached HEAD), not a branch.
#[tauri::command]
pub async fn checkout_commit(repo: Repo<'_>, hash: String) -> Result<(), String> {
    let dir = repo.require()?;
    run_git(&dir, ["checkout", "--detach", assert_hash(&hash)?]).map(drop)
}

/// Creates branch `name` at `hash`, and switches to it when `checkout`.
#[tauri::command]
pub async fn create_branch(
    repo: Repo<'_>,
    name: String,
    hash: String,
    checkout: bool,
) -> Result<(), String> {
    create_branch_in(&repo.require()?, name.trim(), &hash, checkout)
}

fn create_branch_in(dir: &Path, name: &str, hash: &str, checkout: bool) -> Result<(), String> {
    let hash = assert_hash(hash)?;
    let name = assert_new_branch_name(dir, name)?;
    if checkout {
        run_git(dir, ["checkout", "-b", name, hash]).map(drop)
    } else {
        run_git(dir, ["branch", name, hash]).map(drop)
    }
}

/// Tags `hash` as `name`. The tag is annotated (carrying `message`, or the
/// name when that is empty) so that pushing the branch takes it along.
#[tauri::command]
pub async fn create_tag(
    repo: Repo<'_>,
    name: String,
    hash: String,
    message: String,
) -> Result<(), String> {
    create_tag_in(&repo.require()?, name.trim(), &hash, message.trim())
}

fn create_tag_in(dir: &Path, name: &str, hash: &str, message: &str) -> Result<(), String> {
    let hash = assert_hash(hash)?;
    let valid = !name.is_empty()
        && !name.starts_with('-')
        && run_git(dir, ["check-ref-format", &format!("refs/tags/{name}")]).is_ok();
    if !valid {
        return Err(format!("\"{name}\" isn't a valid tag name"));
    }
    let message = if message.is_empty() { name } else { message };
    run_git(dir, ["tag", "-a", name, "-m", message, hash]).map(drop)
}

/// Applies the change made by `hash` as a new commit on `branch`, switching
/// to that branch first when it isn't the current one (and staying there,
/// as GitHub Desktop does). Switching needs a clean working tree, so local
/// changes can't get mixed into the other branch. Stopping on conflicts
/// succeeds, leaving them to the conflict popup.
#[tauri::command]
pub async fn cherry_pick(repo: Repo<'_>, hash: String, branch: String) -> Result<(), String> {
    cherry_pick_in(&repo.require()?, &hash, &branch)
}

fn cherry_pick_in(dir: &Path, hash: &str, branch: &str) -> Result<(), String> {
    let hash = assert_hash(hash)?;
    let branch = assert_branch_name(branch)?;
    if current_branch(dir).as_deref() != Some(branch) {
        require_clean(dir, &format!("cherry-picking onto {branch}"))?;
        run_git(dir, ["checkout", branch])?;
    }
    unless_conflicted(dir, run_git(dir, ["cherry-pick", hash]).map(drop))
}

/// Opens a GitHub page in the default browser. Only `https://github.com/`
/// URLs made of plain URL characters are accepted, so this can't be used to
/// launch a local file or program.
#[tauri::command]
pub async fn open_in_browser(url: String) -> Result<(), String> {
    if !is_github_url(&url) {
        return Err("Only GitHub pages can be opened".into());
    }
    open_url(&url)
}

fn is_github_url(url: &str) -> bool {
    url.strip_prefix("https://github.com/").is_some_and(|rest| {
        !rest.is_empty()
            && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
    })
}

#[cfg(windows)]
fn open_url(url: &str) -> Result<(), String> {
    // url.dll's FileProtocolHandler hands the URL to the default browser
    // without a shell, so nothing in it is interpreted as a command.
    Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(drop)
        .map_err(|error| format!("Could not open the browser: {error}"))
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<(), String> {
    Command::new("open").arg(url).spawn().map(drop).map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url(url: &str) -> Result<(), String> {
    Command::new("xdg-open").arg(url).spawn().map(drop).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::util::test_support::{commit_file, new_repo};

    /// Two commits on main: a.txt, then b.txt.
    fn temp_repo() -> std::path::PathBuf {
        let dir = new_repo("commit-actions");
        commit_file(&dir, "a.txt", "a\n");
        commit_file(&dir, "b.txt", "b\n");
        dir
    }

    fn rev(dir: &Path, spec: &str) -> String {
        run_git(dir, ["rev-parse", spec]).unwrap().trim().to_string()
    }

    #[test]
    fn branches_tags_and_cherry_picks() {
        let dir = temp_repo();
        let first = rev(&dir, "HEAD~1");
        let second = rev(&dir, "HEAD");

        // Branch at the first commit without switching, then with.
        create_branch_in(&dir, "old", &first, false).unwrap();
        assert_eq!(rev(&dir, "old"), first);
        assert_eq!(run_git(&dir, ["branch", "--show-current"]).unwrap().trim(), "main");
        assert!(create_branch_in(&dir, "bad..name", &first, false).is_err());
        assert!(create_branch_in(&dir, "-f", &first, false).is_err());
        create_branch_in(&dir, "feature", &first, true).unwrap();
        assert_eq!(run_git(&dir, ["branch", "--show-current"]).unwrap().trim(), "feature");

        // Annotated tag, message defaulting to the name.
        create_tag_in(&dir, "v1.0", &second, "").unwrap();
        assert_eq!(rev(&dir, "v1.0^{commit}"), second);
        assert_eq!(run_git(&dir, ["cat-file", "-t", "v1.0"]).unwrap().trim(), "tag");
        assert!(create_tag_in(&dir, "bad tag", &second, "").is_err());
        assert!(create_tag_in(&dir, "v2", "HEAD", "").is_err());

        // Cherry-pick main's second commit onto "old" from "feature".
        std::fs::write(dir.join("a.txt"), "dirty\n").unwrap();
        let error = cherry_pick_in(&dir, &second, "old").unwrap_err();
        assert!(error.contains("Commit or stash"), "{error}");
        run_git(&dir, ["checkout", "--", "a.txt"]).unwrap();
        cherry_pick_in(&dir, &second, "old").unwrap();
        assert_eq!(run_git(&dir, ["branch", "--show-current"]).unwrap().trim(), "old");
        assert!(dir.join("b.txt").exists());
        assert_eq!(run_git(&dir, ["log", "-1", "--format=%s"]).unwrap().trim(), "b.txt");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_github_urls_open() {
        assert!(is_github_url("https://github.com/owner/repo/commit/abc123"));
        assert!(!is_github_url("https://github.com/"));
        assert!(!is_github_url("https://github.com.evil.example/x"));
        assert!(!is_github_url("https://github.com/a b"));
        assert!(!is_github_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_github_url("https://github.com/a\"&calc"));
    }
}
