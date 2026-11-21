//! Runs the `git` executable. Arguments go straight to the process (never
//! through a shell), so paths and messages can't be read as shell syntax.

use std::ffi::OsStr;
use std::path::Path;
use std::process::{Command, Stdio};

/// Runs `git <args>` in `dir` and returns its stdout. A non-zero exit becomes
/// an error carrying git's own message.
pub fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new("git");
    command
        .current_dir(dir)
        .args(args)
        .stdin(Stdio::null())
        // Never block waiting on a terminal prompt or an editor.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true");
    hide_console_window(&mut command);

    let output = command
        .output()
        .map_err(|error| format!("Could not run git (is it installed and on PATH?): {error}"))?;

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
