//! Editing a working-tree file in Gitizen's own editor: reading it as text
//! and saving it back, after which it shows as changed like any other edit.

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::git::repository::Repo;
use crate::util::{file_in_repo, write_keeping_line_endings};

/// Files larger than this open in an external editor instead.
const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;

/// How much of a file is checked for NUL bytes to tell text from binary,
/// as git itself does.
const BINARY_CHECK_BYTES: usize = 8000;

/// The working-tree file at `path`, if it is one Gitizen may edit: an
/// existing file inside the repository but outside its `.git` folder.
fn editable_file(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let file = file_in_repo(dir, path)?;
    let first = path.split(['/', '\\']).find(|part| !part.is_empty() && *part != ".");
    if first.is_some_and(|part| part.eq_ignore_ascii_case(".git")) {
        return Err("Files in the .git folder can't be edited".into());
    }
    if !file.is_file() {
        return Err(format!("{path} isn't in the working directory"));
    }
    Ok(file)
}

/// True when `path` is a text file in the working directory that is small
/// enough to edit. Cheap: only the start of the file is read.
#[tauri::command]
pub async fn can_edit_file(repo: Repo<'_>, path: String) -> Result<bool, String> {
    Ok(can_edit_in(&repo.require()?, &path))
}

fn can_edit_in(dir: &Path, path: &str) -> bool {
    let Ok(file) = editable_file(dir, path) else {
        return false;
    };
    let Ok(handle) = std::fs::File::open(&file) else {
        return false;
    };
    let small = handle.metadata().is_ok_and(|meta| meta.len() <= MAX_EDIT_BYTES);
    let mut start = Vec::with_capacity(BINARY_CHECK_BYTES);
    let read = handle.take(BINARY_CHECK_BYTES as u64).read_to_end(&mut start).is_ok();
    small && read && !start.contains(&0)
}

/// The working-tree file's text with "\n" line endings, for editing.
#[tauri::command]
pub async fn working_file(repo: Repo<'_>, path: String) -> Result<String, String> {
    working_file_in(&repo.require()?, &path)
}

fn working_file_in(dir: &Path, path: &str) -> Result<String, String> {
    if !can_edit_in(dir, path) {
        // Says why: missing, outside the repository, or not editable text.
        editable_file(dir, path)?;
        return Err(format!("{path} is a binary or very large file, so it can't be edited here"));
    }
    let bytes = std::fs::read(editable_file(dir, path)?).map_err(|error| error.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{path} isn't UTF-8 text"))?;
    Ok(text.replace("\r\n", "\n"))
}

/// Saves the edited text over the working-tree file, keeping the line
/// endings it already uses. Nothing is staged.
#[tauri::command]
pub async fn save_working_file(repo: Repo<'_>, path: String, text: String) -> Result<(), String> {
    save_in(&repo.require()?, &path, &text)
}

fn save_in(dir: &Path, path: &str, text: &str) -> Result<(), String> {
    write_keeping_line_endings(&editable_file(dir, path)?, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::git::runner::run_git;
    use crate::util::test_support::{commit_file, new_repo};

    #[test]
    fn edits_text_files_in_the_working_directory() {
        let dir = new_repo("edit-file");
        commit_file(&dir, "a.txt", "one\r\ntwo\r\n");
        std::fs::create_dir(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/b.txt"), "b\n").unwrap();
        std::fs::write(dir.join("bin.dat"), b"x\0y").unwrap();

        assert!(can_edit_in(&dir, "a.txt") && can_edit_in(&dir, "sub/b.txt"));
        assert!(!can_edit_in(&dir, "bin.dat") && !can_edit_in(&dir, "missing.txt"));
        assert!(!can_edit_in(&dir, ".git/config") && !can_edit_in(&dir, "./.git/HEAD"));
        assert!(!can_edit_in(&dir, "sub"));

        // Read with "\n", saved with the file's CRLF, and listed as modified.
        assert_eq!(working_file_in(&dir, "a.txt").unwrap(), "one\ntwo\n");
        save_in(&dir, "a.txt", "one\ntwo\nthree\n").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one\r\ntwo\r\nthree\r\n");
        let status = run_git(&dir, ["status", "--porcelain", "--", "a.txt"]).unwrap();
        assert_eq!(status, " M a.txt\n");

        assert!(working_file_in(&dir, "bin.dat").unwrap_err().contains("binary"));
        assert!(working_file_in(&dir, "missing.txt").unwrap_err().contains("isn't in"));
        assert!(save_in(&dir, "missing.txt", "new\n").is_err());
        assert!(!dir.join("missing.txt").exists());
        assert!(save_in(&dir, ".git/config", "").is_err());
        std::fs::write(dir.join("../gitizen-outside-edit.txt"), "keep\n").unwrap();
        assert!(save_in(&dir, "../gitizen-outside-edit.txt", "").is_err());
        let outside = std::fs::read_to_string(dir.join("../gitizen-outside-edit.txt")).unwrap();
        assert_eq!(outside, "keep\n");
        let _ = std::fs::remove_file(dir.join("../gitizen-outside-edit.txt"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
