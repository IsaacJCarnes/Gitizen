//! Gitizen's own settings: the command lines the user sets up for AI
//! commit messages, AI conflict resolving and the external merge tool.
//! They are saved in `settings.json` in the app's config folder, beside the
//! recent repositories list, so they survive restarts.

use ts_rs::TS;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::util::ConfigFile;

/// Settings saved in `settings.json` (see `AppSettings`). Missing fields take
/// their defaults, so older or hand-edited files still load.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Settings {
    /// Shell command that reads a prompt on stdin and prints a commit
    /// message. Empty when not set up yet.
    pub(crate) ai_commit_command: String,
    /// Shell command that reads a conflicted file (with a prompt) on stdin
    /// and prints it resolved. Empty when not set up yet.
    pub(crate) ai_resolve_command: String,
    /// Shell command that opens a conflicted file for editing, with `{file}`
    /// standing for its path. Empty means git's merge tool or the system's
    /// plain text editor.
    pub(crate) editor_command: String,
}

/// Which saved command line a command reads or writes
/// (`SavedCommandKind` in TypeScript).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[ts(export, rename = "SavedCommandKind")]
#[serde(rename_all = "camelCase")]
pub enum SavedCommand {
    AiCommit,
    AiResolve,
    Editor,
}

impl Settings {
    fn command_mut(&mut self, which: SavedCommand) -> &mut String {
        match which {
            SavedCommand::AiCommit => &mut self.ai_commit_command,
            SavedCommand::AiResolve => &mut self.ai_resolve_command,
            SavedCommand::Editor => &mut self.editor_command,
        }
    }

    pub(crate) fn command(mut self, which: SavedCommand) -> String {
        std::mem::take(self.command_mut(which))
    }
}

/// The settings file, kept in Tauri's managed state.
pub(crate) type AppSettings = ConfigFile<Settings>;

impl Default for AppSettings {
    fn default() -> Self {
        ConfigFile::new("settings.json")
    }
}

impl AppSettings {
    /// One of the saved AI commands, or an error asking to set it up.
    pub(crate) fn ai_command(&self, app: &AppHandle, which: SavedCommand) -> Result<String, String> {
        let command = self.read(app)?.command(which);
        if command.is_empty() {
            return Err("No AI command is set up yet".to_string());
        }
        Ok(command)
    }
}

/// The saved command line, or "" when none is set up.
#[tauri::command]
pub async fn saved_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
    which: SavedCommand,
) -> Result<String, String> {
    Ok(state.read(&app)?.command(which))
}

/// Saves a command line (trimmed; "" clears it) and returns what was saved.
#[tauri::command]
pub async fn save_command(
    app: AppHandle,
    state: State<'_, AppSettings>,
    which: SavedCommand,
    command: String,
) -> Result<String, String> {
    let saved = state.update(&app, |settings| *settings.command_mut(which) = command.trim().to_string())?;
    Ok(saved.command(which))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_load_with_defaults() {
        let settings: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, Settings::default());
        let settings: Settings = serde_json::from_str(r#"{"aiCommitCommand":"claude -p"}"#).unwrap();
        assert_eq!(settings.clone().command(SavedCommand::AiCommit), "claude -p");
        // Each command is saved on its own, and is empty until set.
        assert_eq!(settings.command(SavedCommand::AiResolve), "");
        let settings: Settings = serde_json::from_str(r#"{"aiResolveCommand":"codex exec"}"#).unwrap();
        assert_eq!((settings.ai_commit_command.as_str(), settings.ai_resolve_command.as_str()), ("", "codex exec"));
        let which: SavedCommand = serde_json::from_str(r#""editor""#).unwrap();
        assert_eq!(which, SavedCommand::Editor);
    }
}
