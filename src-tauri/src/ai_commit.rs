//! Writes commit messages with an AI command line tool the user configures
//! (for example `claude -p`). Gitizen pipes a prompt plus the staged diff to
//! the command's stdin and reads the message from its stdout; the first line
//! becomes the summary and the rest the description.
//!
//! The command is saved in Gitizen's settings (see `settings.rs`). It runs through the
//! system shell (`cmd` on Windows, `sh` elsewhere) so it is written exactly
//! as it would be in a terminal, and npm shims like `claude.cmd` are found.

use ts_rs::TS;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::git::repository::Repo;
use crate::git::runner::{hide_console_window, run_git};
use crate::settings::{AppSettings, SavedCommand};
use crate::util::blocking;

/// How long the command may run before Gitizen gives up on it.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(180);

/// The most diff text sent to the command; longer diffs are cut here so a
/// huge change (or a committed build output) can't overflow the tool.
pub(crate) const MAX_DIFF_BYTES: usize = 200_000;

const PROMPT: &str = "Write a git commit message for the staged changes below. \
Reply with only the commit message: no commentary, no quotes and no code fences. \
The first line is a summary in the imperative mood, at most 72 characters. \
If the change needs explaining, add a blank line and then a short description \
of what changed and why, wrapped at 72 characters.";

/// A commit message split the way the commit form shows it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, rename = "GeneratedCommitMessage")]
pub struct CommitMessage {
    pub summary: String,
    pub description: String,
}

/// Runs the saved AI command on the staged changes of the open repository
/// and returns the message it wrote. Nothing is staged or committed.
#[tauri::command]
pub async fn generate_commit_message(
    app: AppHandle,
    state: State<'_, AppSettings>,
    repo: Repo<'_>,
) -> Result<CommitMessage, String> {
    let dir = repo.require()?;
    let command = state.ai_command(&app, SavedCommand::AiCommit)?;
    // The command can take a while; other git calls keep answering meanwhile.
    blocking(move || generate_in(&dir, &command)).await
}

/// Builds the prompt from the staged diff in `dir`, runs `command` on it and
/// parses its output.
fn generate_in(dir: &Path, command: &str) -> Result<CommitMessage, String> {
    let diff_args = ["diff", "--cached", "--no-color", "--no-ext-diff"];
    let stat = run_git(dir, diff_args.iter().copied().chain(["--stat"]))?;
    if stat.trim().is_empty() {
        return Err("Stage some changes first, then generate a message for them.".to_string());
    }
    let diff = run_git(dir, diff_args)?;
    let output = run_shell_command(dir, command, &build_prompt(&stat, &diff), TIMEOUT)?;
    parse_message(&output).ok_or_else(|| format!("`{command}` didn't print a commit message."))
}

fn build_prompt(stat: &str, diff: &str) -> String {
    let diff = if diff.len() > MAX_DIFF_BYTES {
        let mut end = MAX_DIFF_BYTES;
        while !diff.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n[The diff is cut off here because it is too long.]\n", &diff[..end])
    } else {
        diff.to_string()
    };
    format!("{PROMPT}\n\nFiles changed:\n{stat}\nDiff:\n{diff}")
}

/// Splits the tool's output into summary (first non-empty line) and
/// description (the rest), dropping code fences a model may add anyway.
/// None if there is no text at all.
fn parse_message(output: &str) -> Option<CommitMessage> {
    let lines: Vec<&str> = output
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim_start().starts_with("```"))
        .collect();
    let first = lines.iter().position(|line| !line.trim().is_empty())?;
    let summary = lines[first].trim().to_string();
    let description = lines[first + 1..].join("\n").trim().to_string();
    Some(CommitMessage { summary, description })
}

/// Runs `command` through the system shell in `dir`, writes `input` to its
/// stdin and returns its stdout. A non-zero exit, or running past `timeout`,
/// is an error carrying the command's own message.
pub(crate) fn run_shell_command(
    dir: &Path,
    command: &str,
    input: &str,
    timeout: Duration,
) -> Result<String, String> {
    let mut child = shell(command)
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not run `{command}`: {error}"))?;

    // Feed stdin and drain stdout/stderr on their own threads, so a command
    // that writes before it has read everything can't deadlock with us.
    let mut stdin = child.stdin.take().expect("stdin is piped");
    let input = input.to_string();
    let writer = std::thread::spawn(move || {
        // A command that exits without reading all its input closes the
        // pipe; that's its business, so the write error is ignored.
        let _ = stdin.write_all(input.as_bytes());
    });
    let stdout = read_on_thread(child.stdout.take().expect("stdout is piped"));
    let stderr = read_on_thread(child.stderr.take().expect("stderr is piped"));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if started.elapsed() > timeout {
            kill_tree(&mut child);
            let _ = child.wait();
            return Err(format!(
                "`{command}` didn't finish within {} seconds, so it was stopped.",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = writer.join();
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();

    if status.success() {
        return Ok(stdout);
    }
    let detail = if stderr.trim().is_empty() { stdout } else { stderr };
    let code = status.code().map_or_else(|| "no exit code".to_string(), |code| format!("exit code {code}"));
    Err(format!("`{command}` failed ({code}):\n{}", detail.trim()))
}

/// Stops the shell and whatever it started (on Windows, killing `cmd` alone
/// would leave the AI tool running).
fn kill_tree(child: &mut std::process::Child) {
    // /T kills the whole tree under the process id, /F without asking it to close.
    #[cfg(windows)]
    let _ = hide_console_window(Command::new("taskkill").args(["/F", "/T", "/PID", &child.id().to_string()]))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

fn read_on_thread(mut pipe: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

/// `cmd /S /C "<command>"` on Windows: with /S, cmd strips just the outer
/// quotes and runs the rest exactly as typed. No console window flashes up.
#[cfg(windows)]
pub(crate) fn shell(command: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut shell = Command::new("cmd");
    // /D skips AutoRun scripts; raw_arg passes the quotes through untouched,
    // where `arg` would escape them.
    hide_console_window(shell.args(["/D", "/S", "/C"]).raw_arg(format!("\"{command}\"")));
    shell
}

#[cfg(not(windows))]
pub(crate) fn shell(command: &str) -> Command {
    let mut shell = Command::new("sh");
    shell.args(["-c", command]);
    shell
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_summary_and_description() {
        let message = parse_message("\n  Add login page  \n\nAdds a form.\nAnd a route.\n").unwrap();
        assert_eq!(message.summary, "Add login page");
        assert_eq!(message.description, "Adds a form.\nAnd a route.");
        let message = parse_message("Fix typo").unwrap();
        assert_eq!(message.description, "");
    }

    #[test]
    fn drops_code_fences_and_rejects_empty_output() {
        let message = parse_message("```\nFix typo\n\nIn the README.\n```\n").unwrap();
        assert_eq!(message, CommitMessage {
            summary: "Fix typo".to_string(),
            description: "In the README.".to_string(),
        });
        assert_eq!(parse_message("  \n```\n"), None);
    }

    #[test]
    fn long_diffs_are_cut() {
        let prompt = build_prompt("a | 1 +\n", &"é".repeat(MAX_DIFF_BYTES));
        assert!(prompt.starts_with(PROMPT));
        assert!(prompt.contains("cut off"));
        assert!(prompt.len() < MAX_DIFF_BYTES + PROMPT.len() + 200);
    }

    /// Runs a fake "AI" through the real shell against a temp repository.
    #[test]
    fn runs_the_command_on_the_staged_diff() {
        let dir = crate::util::test_support::new_repo("ai");

        let error = generate_in(&dir, "echo Unused").unwrap_err();
        assert!(error.contains("Stage some changes"), "{error}");

        std::fs::write(dir.join("notes.txt"), "hello\n").unwrap();
        run_git(&dir, ["add", "notes.txt"]).unwrap();

        // Echoes stdin back, so the output starts with the prompt's first line.
        let echo = if cfg!(windows) { "findstr \"^\"" } else { "cat" };
        let message = generate_in(&dir, echo).unwrap();
        assert!(message.summary.starts_with("Write a git commit message"), "{}", message.summary);
        assert!(message.description.contains("notes.txt"));
        assert!(message.description.contains("+hello"));

        let message = generate_in(&dir, "echo Add notes").unwrap();
        assert_eq!(message.summary, "Add notes");

        let error = generate_in(&dir, "echo broken 1>&2 && exit 3").unwrap_err();
        assert!(error.contains("exit code 3") && error.contains("broken"), "{error}");

        let error = run_shell_command(&dir, &slow_command(), "", Duration::from_millis(300)).unwrap_err();
        assert!(error.contains("didn't finish"), "{error}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn slow_command() -> String {
        if cfg!(windows) { "ping -n 5 127.0.0.1 >nul".to_string() } else { "sleep 5".to_string() }
    }
}
