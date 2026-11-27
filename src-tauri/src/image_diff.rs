//! Both versions of an image file, for the image diff viewer: the old side
//! and the new side of a working-tree change, a commit or a stash, each as
//! a `data:` URL the webview can show directly.

use ts_rs::TS;
use std::path::Path;

use serde::Serialize;

use crate::git::repository::{assert_hash, Repo};
use crate::git::runner::run_git_bytes;
use crate::util::file_in_repo;

/// Larger images aren't sent to the webview.
const MAX_BYTES: usize = 40 * 1024 * 1024;

/// The two sides of an image's change. A side is None when the file
/// doesn't exist there (added or deleted).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ImageVersions {
    pub old: Option<String>,
    pub new: Option<String>,
}

/// Both versions of image `path`: in the working tree against HEAD when
/// `hash` is None, in commit `hash` against its first parent, or in stash
/// `hash` (with `stash`) against the commit it was made on. `old_path` is
/// a renamed file's previous path.
#[tauri::command]
pub async fn image_versions(
    repo: Repo<'_>,
    path: String,
    old_path: Option<String>,
    hash: Option<String>,
    stash: Option<bool>,
) -> Result<ImageVersions, String> {
    image_versions_in(&repo.require()?, &path, old_path.as_deref(), hash.as_deref(), stash == Some(true))
}

fn image_versions_in(
    dir: &Path,
    path: &str,
    old_path: Option<&str>,
    hash: Option<&str>,
    stash: bool,
) -> Result<ImageVersions, String> {
    let old_path = old_path.unwrap_or(path);
    let (old, new) = match hash {
        None => {
            // Before the first commit there is no HEAD, so no old side.
            let old = blob(dir, "HEAD", old_path);
            let file = file_in_repo(dir, path)?;
            let new = if file.is_file() {
                Some(std::fs::read(&file).map_err(|error| error.to_string())?)
            } else {
                None
            };
            (old, new)
        }
        Some(hash) if stash => {
            let hash = assert_hash(hash)?;
            // An untracked file is kept in the stash's third parent, and is new.
            let untracked = format!("{hash}^3");
            match blob(dir, &untracked, path) {
                Some(new) => (None, Some(new)),
                None => (blob(dir, &format!("{hash}^1"), old_path), blob(dir, hash, path)),
            }
        }
        Some(hash) => {
            let hash = assert_hash(hash)?;
            // A root commit has no parent, so no old side.
            (blob(dir, &format!("{hash}^"), old_path), blob(dir, hash, path))
        }
    };
    Ok(ImageVersions { old: old.map(|bytes| data_url(path, &bytes)).transpose()?, new: new.map(|bytes| data_url(path, &bytes)).transpose()? })
}

/// The file at `path` in `revision`, or None if it isn't there.
fn blob(dir: &Path, revision: &str, path: &str) -> Option<Vec<u8>> {
    // "<rev>:<path>" names the blob; `cat-file blob` fails unless it exists and is a file.
    let spec = format!("{revision}:{path}");
    run_git_bytes(dir, ["cat-file", "blob", spec.as_str()]).ok()
}

/// `bytes` as a `data:` URL, typed by `path`'s extension.
fn data_url(path: &str, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("This image is too large to preview.".into());
    }
    let extension = path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", base64(bytes)))
}

/// Standard base64 with padding.
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        let char_at = |shift: u32| TABLE[((n >> shift) & 63) as usize] as char;
        out.push(char_at(18));
        out.push(char_at(12));
        out.push(if chunk.len() > 1 { char_at(6) } else { '=' });
        out.push(if chunk.len() > 2 { char_at(0) } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{commit_file, git, new_repo};

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn reads_both_sides_of_an_image() {
        let dir = new_repo("image-diff");
        commit_file(&dir, "pic.png", "one");
        let first = git(&dir, &["rev-parse", "HEAD"]).trim().to_string();
        commit_file(&dir, "pic.png", "two");
        let second = git(&dir, &["rev-parse", "HEAD"]).trim().to_string();
        std::fs::write(dir.join("pic.png"), "three").unwrap();

        let url = |text: &str| Some(format!("data:image/png;base64,{}", base64(text.as_bytes())));
        let versions = image_versions_in(&dir, "pic.png", None, None, false).unwrap();
        assert_eq!(versions, ImageVersions { old: url("two"), new: url("three") });
        let versions = image_versions_in(&dir, "pic.png", None, Some(&second), false).unwrap();
        assert_eq!(versions, ImageVersions { old: url("one"), new: url("two") });
        // The first commit added it.
        let versions = image_versions_in(&dir, "pic.png", None, Some(&first), false).unwrap();
        assert_eq!(versions, ImageVersions { old: None, new: url("one") });

        let _ = std::fs::remove_dir_all(&dir);
    }
}
