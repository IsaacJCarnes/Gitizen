/**
 * The UI's bridge to the Rust backend: implements `GitizenApi` by calling
 * the Tauri commands in src-tauri/src/commands.rs.
 *
 * Tauri maps camelCase argument keys here to the snake_case parameter names
 * in Rust (e.g. `oldPath` -> `old_path`). A failed command rejects with git's
 * error message as a string (opening a repository rejects with an
 * `OpenRepositoryError` object instead).
 */
import { invoke } from "@tauri-apps/api/core";
import { Command, type GitizenApi } from "../../shared/ipc";

export const gitizen: GitizenApi = {
  openRepo: () => invoke(Command.OpenRepository),
  initRepo: (path) => invoke(Command.InitRepository, { path }),
  openRepoAt: (path) => invoke(Command.OpenRepositoryAt, { path }),
  recentRepos: () => invoke(Command.RecentRepositories),
  rememberRepo: (path) => invoke(Command.RememberRepository, { path }),
  forgetRepo: (path) => invoke(Command.ForgetRepository, { path }),
  status: () => invoke(Command.Status),
  log: () => invoke(Command.Log),
  branches: () => invoke(Command.Branches),
  fileDiff: (path, ignoreWhitespace) =>
    invoke(Command.FileDiff, { path, ignoreWhitespace }),
  fileText: (path, hash) => invoke(Command.FileText, { path, hash }),
  commitFiles: (hash) => invoke(Command.CommitFiles, { hash }),
  commitDiff: (hash, path, oldPath, ignoreWhitespace) =>
    invoke(Command.CommitDiff, { hash, path, oldPath, ignoreWhitespace }),
  stage: (paths) => invoke(Command.Stage, { paths }),
  unstage: (paths) => invoke(Command.Unstage, { paths }),
  setStagedLines: (path, diff, lines, staged) =>
    invoke(Command.SetStagedLines, { path, diff, lines, staged }),
  commit: (message) => invoke(Command.Commit, { message }),
  checkout: (branch) => invoke(Command.Checkout, { branch }),
  aiCommitCommand: () => invoke(Command.AiCommitCommand),
  setAiCommitCommand: (command) => invoke(Command.SetAiCommitCommand, { command }),
  generateCommitMessage: () => invoke(Command.GenerateCommitMessage),
};
