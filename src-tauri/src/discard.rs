//! Throwing away uncommitted changes: whole files from the changes list, or
//! single lines from a file's diff. Discarded changes aren't kept anywhere
//! (unlike a stash), which is why the UI asks first.

use std::collections::HashSet;
use std::path::Path;

use crate::working_tree::{combined_diff, head_text, staged_lines_of, write_index_lines};
use crate::git::patch::{changed_line_indices, index_content, STALE};
use crate::git::repository::Repo;
use crate::git::runner::{run_git, run_git_with_input};
use crate::util::{file_in_repo, write_keeping_line_endings};

/// Puts each file back the way it is in HEAD, staged and unstaged changes
/// alike. A file HEAD doesn't have (untracked or newly added) is deleted.
/// For a rename, pass both paths so the old file comes back too.
#[tauri::command]
pub async fn discard_files(repo: Repo<'_>, paths: Vec<String>) -> Result<(), String> {
    discard_files_in(&repo.require()?, &paths)
}

pub(crate) fn discard_files_in(dir: &Path, paths: &[String]) -> Result<(), String> {
    let (mut committed, mut new) = (Vec::new(), Vec::new());
    for (path, in_head) in paths.iter().zip(in_head(dir, paths)) {
        if in_head {
            committed.push(path.clone());
        } else {
            new.push(path);
        }
    }
    if !committed.is_empty() {
        // All in one checkout, from HEAD, so the index entries are reset
        // along with the files.
        let args = ["checkout", "HEAD", "--"].into_iter().map(String::from);
        run_git(dir, args.chain(committed))?;
    }
    for path in new {
        let file = file_in_repo(dir, path)?;
        // Only files git lists as changed are deleted, never anything else.
        let status = run_git(dir, ["status", "--porcelain", "--untracked-files=all", "--", path])?;
        if status.trim().is_empty() {
            continue;
        }
        run_git(dir, ["rm", "-q", "--cached", "--ignore-unmatch", "--", path])?;
        if file.is_file() {
            std::fs::remove_file(&file).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// For each of `paths`, whether HEAD has it (also for files `git show`
/// can't print as text), asked of one `git cat-file --batch-check`.
fn in_head(dir: &Path, paths: &[String]) -> Vec<bool> {
    let spec = |path: &String| format!("HEAD:./{path}");
    // The batch reads one name per line, so a path with a line break is asked on its own.
    if paths.iter().any(|path| path.contains('\n')) {
        return paths.iter().map(|path| run_git(dir, ["cat-file", "-e", &spec(path)]).is_ok()).collect();
    }
    let input: String = paths.iter().map(|path| spec(path) + "\n").collect();
    let output = run_git_with_input(dir, ["cat-file", "--batch-check"], &input).unwrap_or_default();
    // One line per name: "<hash> <type> <size>", or "<name> missing".
    let mut lines = output.lines();
    paths.iter().map(|_| lines.next().is_some_and(|line| !line.ends_with(" missing"))).collect()
}

/// Throws away single changed lines of one file: a removed line comes back
/// and an added line goes, in the working tree and (if it was staged) in the
/// index too. `diff` is the diff `file_diff` returned with whitespace shown,
/// and `lines` are indices into its lines. Discarding every changed line is
/// the same as discarding the file. If the file changed since the diff was
/// shown, nothing is changed.
#[tauri::command]
pub async fn discard_lines(
    repo: Repo<'_>,
    path: String,
    diff: String,
    lines: Vec<usize>,
) -> Result<(), String> {
    discard_lines_in(&repo.require()?, &path, &diff, &lines)
}

fn discard_lines_in(dir: &Path, path: &str, diff: &str, lines: &[usize]) -> Result<(), String> {
    let combined = combined_diff(dir, path, None)?;
    let current = &combined.diff;
    if *current != diff {
        return Err(STALE.into());
    }
    let discarded: HashSet<usize> = lines.iter().copied().collect();
    let changed = changed_line_indices(current);
    if changed.is_subset(&discarded) {
        return discard_files_in(dir, &[path.to_string()]);
    }
    let file = file_in_repo(dir, path)?;

    // The file keeps every change but the discarded ones.
    let head = head_text(dir, path).unwrap_or_default();
    let kept: HashSet<usize> = changed.difference(&discarded).copied().collect();
    let text = index_content(&head, current, &kept)?;

    // A staged line that is discarded leaves the index too; the index is
    // written first, while the file still matches the diff.
    let staged: HashSet<usize> = staged_lines_of(dir, path, &combined)?.into_iter().collect();
    if !staged.is_disjoint(&discarded) {
        let still_staged = staged.difference(&discarded).copied().collect();
        write_index_lines(dir, path, current, &still_staged)?;
    }
    write_keeping_line_endings(&file, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::working_tree::file_diff_in;
    use crate::util::test_support::{commit_file, git, new_repo};

    /// Index of the diff line equal to `line`.
    fn at(diff: &str, line: &str) -> usize {
        diff.split('\n').position(|l| l == line).unwrap()
    }

    fn read(dir: &Path, name: &str) -> String {
        std::fs::read_to_string(dir.join(name)).unwrap()
    }

    #[test]
    fn discards_whole_files() {
        let dir = new_repo("discard-files");
        commit_file(&dir, "a.txt", "a\n");
        commit_file(&dir, "b.txt", "b\n");

        // A staged edit, an unstaged deletion, a new file, a staged new file.
        std::fs::write(dir.join("a.txt"), "changed\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        std::fs::remove_file(dir.join("b.txt")).unwrap();
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();
        std::fs::write(dir.join("added.txt"), "added\n").unwrap();
        git(&dir, &["add", "added.txt"]);
        let all = ["a.txt", "b.txt", "new.txt", "added.txt"].map(String::from);
        discard_files_in(&dir, &all).unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");
        assert_eq!(read(&dir, "a.txt"), "a\n");
        assert!(!dir.join("new.txt").exists() && !dir.join("added.txt").exists());

        // A staged rename: both halves go back.
        git(&dir, &["mv", "a.txt", "moved.txt"]);
        discard_files_in(&dir, &["moved.txt".into(), "a.txt".into()]).unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");

        // Files outside the repository, or without changes, are left alone.
        std::fs::write(dir.join("../gitizen-outside-discard.txt"), "keep\n").unwrap();
        assert!(discard_files_in(&dir, &["../gitizen-outside-discard.txt".into()]).is_err());
        assert!(dir.join("../gitizen-outside-discard.txt").exists());
        let _ = std::fs::remove_file(dir.join("../gitizen-outside-discard.txt"));
        std::fs::create_dir(dir.join("ignored")).unwrap();
        std::fs::write(dir.join(".gitignore"), "ignored/\n").unwrap();
        std::fs::write(dir.join("ignored/keep.txt"), "keep\n").unwrap();
        discard_files_in(&dir, &["ignored/keep.txt".into()]).unwrap();
        assert!(dir.join("ignored/keep.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discards_single_lines() {
        let dir = new_repo("discard-lines");
        commit_file(&dir, "f.txt", "one\ntwo\nthree\n");

        // two -> TWO (staged), plus "four" added (unstaged).
        std::fs::write(dir.join("f.txt"), "one\nTWO\nthree\n").unwrap();
        git(&dir, &["add", "f.txt"]);
        std::fs::write(dir.join("f.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        let diff = file_diff_in(&dir, "f.txt", None).unwrap().diff;

        // Discarding "+four" only touches the working tree.
        discard_lines_in(&dir, "f.txt", &diff, &[at(&diff, "+four")]).unwrap();
        assert_eq!(read(&dir, "f.txt"), "one\nTWO\nthree\n");
        assert_eq!(git(&dir, &["show", ":f.txt"]), "one\nTWO\nthree\n");

        // A stale diff is refused.
        assert_eq!(discard_lines_in(&dir, "f.txt", &diff, &[0]).unwrap_err(), STALE);

        // Discarding the staged "-two" brings "two" back in the file and index.
        let diff = file_diff_in(&dir, "f.txt", None).unwrap().diff;
        discard_lines_in(&dir, "f.txt", &diff, &[at(&diff, "-two")]).unwrap();
        assert_eq!(read(&dir, "f.txt"), "one\ntwo\nTWO\nthree\n");
        assert_eq!(git(&dir, &["show", ":f.txt"]), "one\ntwo\nTWO\nthree\n");

        // Discarding every remaining change is discarding the file.
        let diff = file_diff_in(&dir, "f.txt", None).unwrap().diff;
        discard_lines_in(&dir, "f.txt", &diff, &[at(&diff, "+TWO")]).unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");

        // CRLF files keep their line endings; new files lose single lines.
        git(&dir, &["config", "core.autocrlf", "true"]);
        std::fs::write(dir.join("f.txt"), "one\r\nx\r\ntwo\r\ny\r\nthree\r\n").unwrap();
        let diff = file_diff_in(&dir, "f.txt", None).unwrap().diff;
        discard_lines_in(&dir, "f.txt", &diff, &[at(&diff, "+x")]).unwrap();
        assert_eq!(read(&dir, "f.txt"), "one\r\ntwo\r\ny\r\nthree\r\n");
        git(&dir, &["config", "core.autocrlf", "false"]);
        std::fs::write(dir.join("new.txt"), "a\nb\n").unwrap();
        let new = file_diff_in(&dir, "new.txt", None).unwrap().diff;
        discard_lines_in(&dir, "new.txt", &new, &[at(&new, "+a")]).unwrap();
        assert_eq!(read(&dir, "new.txt"), "b\n");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
