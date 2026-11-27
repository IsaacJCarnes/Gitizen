//! Runs the `git` executable. Arguments go straight to the process (never
//! through a shell), so paths and messages can't be read as shell syntax.

use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;

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
    run_command(git_command(dir, args))
}

/// Like `run_git`, but writes `input` to git's stdin (e.g. file content for
/// `git hash-object --stdin`).
pub fn run_git_with_input<I, S>(dir: &Path, args: I, input: &str) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let stdout = run_command_with_input(git_command(dir, args), input)?;
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

/// Runs a prepared command (from `git_command`, with any extra environment
/// set) with nothing on stdin, returning its stdout as `into_result` does.
pub(crate) fn run_command(mut command: Command) -> Result<Vec<u8>, String> {
    into_result(command.stdin(Stdio::null()).output().map_err(could_not_run)?)
}

/// Like `run_command`, but writes `input` to the command's stdin.
pub(crate) fn run_command_with_input(mut command: Command, input: &str) -> Result<Vec<u8>, String> {
    let mut child = command
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

/// A `git` command in `dir` that never prompts or opens an editor, for
/// callers that need the exit code or output themselves.
pub(crate) fn git_command<I, S>(dir: &Path, args: I) -> Command
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let program = git_program();
    let mut command = Command::new(&program.program);
    if let Some(path) = &program.path {
        command.env("PATH", path);
    }
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

/// The git executable Gitizen starts, and the PATH to start it with.
struct GitProgram {
    program: PathBuf,
    /// Set when `program` needs folders of its own on PATH (see `git_program`).
    path: Option<OsString>,
}

/// The git to run, worked out once. On Windows the `git` on PATH is usually
/// Git for Windows' `cmd\git.exe`, a small launcher that sets up PATH and
/// then starts the real git, so every command pays for two process starts.
/// Gitizen starts the real one (`git.exe` in `git --exec-path`) itself,
/// with the launcher's folders (its `bin` and `usr\bin`, for the shell, ssh
/// and credential helpers) put first on PATH, as GitHub Desktop does with
/// its own git. Anywhere else, or if that git can't be found, plain `git`.
fn git_program() -> &'static GitProgram {
    static PROGRAM: OnceLock<GitProgram> = OnceLock::new();
    PROGRAM.get_or_init(|| real_git().unwrap_or(GitProgram { program: PathBuf::from("git"), path: None }))
}

#[cfg(windows)]
fn real_git() -> Option<GitProgram> {
    let mut command = Command::new("git");
    hide_console_window(command.arg("--exec-path").stdin(Stdio::null()));
    let output = command.output().ok().filter(|output| output.status.success())?;
    // e.g. "C:/Program Files/Git/ucrt64/libexec/git-core"
    let exec_path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let program = exec_path.join("git.exe");
    let prefix = exec_path.parent()?.parent()?; // ...\Git\ucrt64 (or mingw64)
    let root = prefix.parent()?; // ...\Git
    if !program.is_file() {
        return None;
    }
    let mut folders = vec![prefix.join("bin"), root.join("usr").join("bin")];
    folders.extend(std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect::<Vec<_>>()).unwrap_or_default());
    Some(GitProgram { program, path: std::env::join_paths(folders).ok() })
}

#[cfg(not(windows))]
fn real_git() -> Option<GitProgram> {
    None
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
