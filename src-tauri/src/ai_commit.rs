//! Writes commit messages with an AI command line tool the user configures
//! (for example `claude -p`). Gitizen pipes a prompt plus the staged diff to
//! the command's stdin and reads the message from its stdout; the first line
//! becomes the summary and the rest the description.
//!
//! The command is saved in `settings.json` in the app's config folder, beside
//! the recent repositories list, so it survives restarts. It runs through the
//! system shell (`cmd` on Windows, `sh` elsewhere) so it is written exactly
//! as it would be in a terminal, and npm shims like `claude.cmd` are found.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::git::repository::OpenRepository;
use crate::git::runner::run_git;

const FILE_NAME: &str = "settings.json";

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

/// Settings saved in `settings.json`. Missing fields take their defaults, so
/// older or hand-edited files still load.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Settings {
    /// Shell command that reads a prompt on stdin and prints a commit
    /// message (also used to resolve merge conflicts). Empty when not set up yet.
    pub(crate) ai_commit_command: String,
    /// Shell command that opens a conflicted file for editing, with `{file}`
    /// standing for its path. Empty means the system's plain text editor.
    pub(crate) editor_command: String,
}

/// Serialises reads and writes of the settings file.
#[derive(Default)]
pub struct AppSettings(Mutex<()>);

impl AppSettings {
    pub(crate) fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.0.lock().map_err(|_| "Settings are unavailable".to_string())
    }
}

/// A commit message split the way the commit form shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommitMessage {
    pub summary: String,
    pub description: String,
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    Ok(dir.join(FILE_NAME))
}

/// A missing or unreadable file is the default settings, so a corrupt file
/// never stops the app from working.
pub(crate) fn load(app: &AppHandle) -> Result<Settings, String> {
    let path = file_path(app)?;
    Ok(std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

pub(crate) fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = file_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    std::fs::write(path, text).map_err(|error| error.to_string())
}

/// The saved AI command, or an empty string if none is set up.
#[tauri::command]
pub async fn ai_commit_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
) -> Result<String, String> {
    let _guard = state.lock()?;
    Ok(load(&app)?.ai_commit_command)
}

/// Saves the AI command (trimmed; empty clears it) and returns what was saved.
#[tauri::command]
pub async fn set_ai_commit_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
    command: String,
) -> Result<String, String> {
    let _guard = state.lock()?;
    let mut settings = load(&app)?;
    settings.ai_commit_command = command.trim().to_string();
    save(&app, &settings)?;
    Ok(settings.ai_commit_command)
}

/// Runs the saved AI command on the staged changes of the open repository
/// and returns the message it wrote. Nothing is staged or committed.
#[tauri::command]
pub async fn generate_commit_message(
    app: AppHandle,
    state: State<'_, AppSettings>,
    repo: State<'_, OpenRepository>,
) -> Result<CommitMessage, String> {
    let dir = repo.require()?;
    let command = {
        let _guard = state.lock()?;
        load(&app)?.ai_commit_command
    };
    if command.is_empty() {
        return Err("No AI command is set up yet".to_string());
    }
    // The command can take a while; run it off the async runtime's workers
    // so other git calls keep answering meanwhile.
    tauri::async_runtime::spawn_blocking(move || generate_in(&dir, &command))
        .await
        .map_err(|error| error.to_string())?
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status();
    }
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
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut shell = Command::new("cmd");
    shell.args(["/D", "/S", "/C"]).raw_arg(format!("\"{command}\"")).creation_flags(CREATE_NO_WINDOW);
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

    #[test]
    fn settings_load_with_defaults() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, Settings::default());
        let settings: Settings = serde_json::from_str(r#"{"aiCommitCommand":"claude -p"}"#).unwrap();
        assert_eq!(settings.ai_commit_command, "claude -p");
    }

    /// Runs a fake "AI" through the real shell against a temp repository.
    #[test]
    fn runs_the_command_on_the_staged_diff() {
        let dir = std::env::temp_dir().join(format!("gitizen-ai-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| run_git(&dir, args).unwrap();
        git(&["init", "-q"]);

        let error = generate_in(&dir, "echo Unused").unwrap_err();
        assert!(error.contains("Stage some changes"), "{error}");

        std::fs::write(dir.join("notes.txt"), "hello\n").unwrap();
        git(&["add", "notes.txt"]);

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
