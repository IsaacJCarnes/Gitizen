//! Runs the `git` executable. Arguments go straight to the process (never
//! through a shell), so paths and messages can't be read as shell syntax.

use std::ffi::OsStr;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

/// Runs `git <args>` in `dir` and returns its stdout. A non-zero exit becomes
/// an error carrying git's own message.
pub fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_git_bytes(dir, args).map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// Like `run_git`, but returns stdout as raw bytes, for file contents that
/// may not be text.
pub fn run_git_bytes<I, S>(dir: &Path, args: I) -> Result<Vec<u8>, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = git_command(dir, args).stdin(Stdio::null()).output().map_err(could_not_run)?;
    into_result(output)
}

/// Like `run_git`, but writes `input` to git's stdin (e.g. file content for
/// `git hash-object --stdin`).
pub fn run_git_with_input<I, S>(dir: &Path, args: I, input: &str) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut child = git_command(dir, args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(could_not_run)?;
    // Dropping stdin after writing closes it, so git sees the end of input.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).map_err(|error| error.to_string())?;
    }
    let stdout = into_result(child.wait_with_output().map_err(could_not_run)?)?;
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

/// A `git` command in `dir` that never prompts or opens an editor, for
/// callers that need the exit code or output themselves.
pub(crate) fn git_command<I, S>(dir: &Path, args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new("git");
    command
        .current_dir(dir)
        .args(args)
        // Never block waiting on a terminal prompt or an editor.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        // Reading commands (status, diff) never rewrite the index, so the
        // file watcher doesn't see Gitizen's own refreshes as changes.
        .env("GIT_OPTIONAL_LOCKS", "0");
    hide_console_window(&mut command);
    command
}

fn could_not_run(error: std::io::Error) -> String {
    format!("Could not run git (is it installed and on PATH?): {error}")
}

/// stdout on success, otherwise the program's own message: stderr, or stdout
/// when stderr is empty (as for `git commit` with nothing to commit).
pub(crate) fn into_result(output: Output) -> Result<Vec<u8>, String> {
    if output.status.success() {
        return Ok(output.stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = if stderr.trim().is_empty() { stdout } else { stderr };
    Err(message.trim().to_string())
}

/// Stops Windows from flashing a console window for every git call (and
/// every other program Gitizen runs in the background).
#[cfg(windows)]
pub(crate) fn hide_console_window(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub(crate) fn hide_console_window(command: &mut Command) -> &mut Command {
    command
}
