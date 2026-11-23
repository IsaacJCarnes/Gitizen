//! Small helpers shared by the command modules.

use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// A JSON file in the app's config folder (e.g. the settings or the recent
/// repositories), kept in Tauri's managed state. A lock serialises reads and
/// writes, so two quick commands can't interleave and lose a change.
pub struct ConfigFile<T> {
    name: &'static str,
    lock: Mutex<()>,
    // Ties the file to its contents' type without storing one.
    contents: PhantomData<fn() -> T>,
}

impl<T: Serialize + DeserializeOwned + Default> ConfigFile<T> {
    pub(crate) const fn new(name: &'static str) -> Self {
        Self { name, lock: Mutex::new(()), contents: PhantomData }
    }

    /// The saved contents.
    pub(crate) fn read(&self, app: &AppHandle) -> Result<T, String> {
        let _guard = self.locked()?;
        self.load(app)
    }

    /// Loads the contents, lets `change` edit them and saves the result,
    /// returning what was saved. The lock is held throughout.
    pub(crate) fn update(&self, app: &AppHandle, change: impl FnOnce(&mut T)) -> Result<T, String> {
        let _guard = self.locked()?;
        let mut contents = self.load(app)?;
        change(&mut contents);
        let path = self.path(app)?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        }
        let text = serde_json::to_string_pretty(&contents).map_err(|error| error.to_string())?;
        std::fs::write(path, text).map_err(|error| error.to_string())?;
        Ok(contents)
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.lock.lock().map_err(|_| format!("{} is unavailable", self.name))
    }

    fn path(&self, app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
        Ok(dir.join(self.name))
    }

    /// A missing or unreadable file is the default, so a corrupt file never
    /// stops the app from working.
    fn load(&self, app: &AppHandle) -> Result<T, String> {
        Ok(parse_config(&std::fs::read_to_string(self.path(app)?).unwrap_or_default()))
    }
}

/// Parses a config file's text, falling back to the default when it isn't
/// valid JSON of the right shape.
pub(crate) fn parse_config<T: DeserializeOwned + Default>(text: &str) -> T {
    serde_json::from_str(text).unwrap_or_default()
}

/// Runs `work` on a blocking thread, so a slow call (the network, an AI
/// command, a merge tool the user has open) doesn't hold up the async
/// runtime's workers and other commands keep answering meanwhile.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    // The outer `?` is the thread panicking; the inner Result is `work`'s own.
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

/// A new, empty folder in the system temp folder. The process id and the
/// time in nanoseconds keep concurrent callers (and test runs) apart.
pub(crate) fn unique_temp_dir(label: &str) -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let dir = std::env::temp_dir().join(format!("gitizen-{label}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Writes `text` (edited in the UI with "\n" line endings) to `file`,
/// putting back the CRLF line endings the file already uses, if any.
pub(crate) fn write_keeping_line_endings(file: &Path, text: &str) -> Result<(), String> {
    let crlf = std::fs::read(file).is_ok_and(|bytes| bytes.windows(2).any(|pair| pair == b"\r\n"));
    let normalized = text.replace("\r\n", "\n");
    let contents = if crlf { normalized.replace('\n', "\r\n") } else { normalized };
    std::fs::write(file, contents).map_err(|error| error.to_string())
}

/// `path` (relative to the repository folder `dir`) as a file inside the
/// repository. Fails for paths that lead outside it, e.g. through "..".
/// A file that doesn't exist yet is checked through its folder.
pub(crate) fn file_in_repo(dir: &Path, path: &str) -> Result<PathBuf, String> {
    let file = dir.join(path);
    let root = dir.canonicalize().map_err(|error| error.to_string())?;
    // The nearest part of the path that exists decides where it really is.
    let existing = file.ancestors().find(|candidate| candidate.exists());
    let inside = existing
        .and_then(|candidate| candidate.canonicalize().ok())
        .is_some_and(|candidate| candidate.starts_with(&root));
    if inside && !path.split(['/', '\\']).any(|part| part == "..") {
        Ok(file)
    } else {
        Err(format!("{path} is outside the repository"))
    }
}

/// Test helpers for building throwaway repositories.
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};

    use crate::git::runner::run_git;

    /// Runs git in `dir`, panicking on failure, and returns its stdout.
    pub(crate) fn git(dir: &Path, args: &[&str]) -> String {
        run_git(dir, args).unwrap()
    }

    /// An empty repository on `main` with an author set and line endings
    /// left alone, so tests behave the same on every machine.
    pub(crate) fn new_repo(label: &str) -> PathBuf {
        let dir = super::unique_temp_dir(label).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "core.autocrlf", "false"]);
        dir
    }

    /// Writes `name` with `text`, stages it and commits it with the file
    /// name as the message.
    pub(crate) fn commit_file(dir: &Path, name: &str, text: &str) {
        std::fs::write(dir.join(name), text).unwrap();
        git(dir, &["add", "--", name]);
        git(dir, &["commit", "-q", "-m", name]);
    }
}
