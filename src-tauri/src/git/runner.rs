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
    let mut command = git_command(dir, args);
    let output = command.stdin(Stdio::null()).output().map_err(could_not_run)?;
    into_result(output)
}

/// Like `run_git`, but writes `input` to git's stdin (e.g. a patch for
/// `git apply -`).
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
    into_result(child.wait_with_output().map_err(could_not_run)?)
}

/// Like `run_git`, but returns stdout as raw bytes, for file contents that
/// may not be text.
pub fn run_git_bytes<I, S>(dir: &Path, args: I) -> Result<Vec<u8>, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = git_command(dir, args);
    let output = command.stdin(Stdio::null()).output().map_err(could_not_run)?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        into_result(output).map(String::into_bytes)
    }
}

fn git_command<I, S>(dir: &Path, args: I) -> Command
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
        .env("GIT_EDITOR", "true");
    hide_console_window(&mut command);
    command
}

fn could_not_run(error: std::io::Error) -> String {
    format!("Could not run git (is it installed and on PATH?): {error}")
}

/// stdout on success, otherwise git's own message.
fn into_result(output: Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = if stderr.trim().is_empty() { stdout } else { stderr };
        Err(message.trim().to_string())
    }
}

/// Stops Windows from flashing a console window for every git call.
#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}
