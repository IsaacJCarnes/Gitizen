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
  discardFiles: (paths) => invoke(Command.DiscardFiles, { paths }),
  discardLines: (path, diff, lines) => invoke(Command.DiscardLines, { path, diff, lines }),
  canEditFile: (path) => invoke(Command.CanEditFile, { path }),
  workingFile: (path) => invoke(Command.WorkingFile, { path }),
  saveWorkingFile: (path, text) => invoke(Command.SaveWorkingFile, { path, text }),
  commit: (message, amend) => invoke(Command.Commit, { message, amend }),
  undoLastCommit: () => invoke(Command.UndoLastCommit),
  stashChanges: (message) => invoke(Command.StashChanges, { message }),
  checkout: (branch) => invoke(Command.Checkout, { branch }),
  aiCommitCommand: () => invoke(Command.AiCommitCommand),
  setAiCommitCommand: (command) => invoke(Command.SetAiCommitCommand, { command }),
  generateCommitMessage: () => invoke(Command.GenerateCommitMessage),
  remotes: () => invoke(Command.Remotes),
  addRemote: (name, url) => invoke(Command.AddRemote, { name, url }),
  // The Rust parameter is named `private`, which is reserved in TypeScript.
  publishRepository: (name, description, isPrivate) =>
    invoke(Command.PublishRepository, { name, description, private: isPrivate }),
  fetch: () => invoke(Command.Fetch),
  pull: () => invoke(Command.Pull),
  push: (force) => invoke(Command.Push, { force }),
  checkoutCommit: (hash) => invoke(Command.CheckoutCommit, { hash }),
  createBranch: (name, hash, checkout) => invoke(Command.CreateBranch, { name, hash, checkout }),
  createTag: (name, hash, message) => invoke(Command.CreateTag, { name, hash, message }),
  cherryPick: (hash, branch) => invoke(Command.CherryPick, { hash, branch }),
  openInBrowser: (url) => invoke(Command.OpenInBrowser, { url }),
  conflicts: () => invoke(Command.Conflicts),
  resolveConflict: (path, resolution) => invoke(Command.ResolveConflict, { path, resolution }),
  continueOperation: () => invoke(Command.ContinueOperation),
  abortOperation: () => invoke(Command.AbortOperation),
  aiResolveConflict: (path) => invoke(Command.AiResolveConflict, { path }),
  aiResolveCommand: () => invoke(Command.AiResolveCommand),
  setAiResolveCommand: (command) => invoke(Command.SetAiResolveCommand, { command }),
  conflictVersions: (path) => invoke(Command.ConflictVersions, { path }),
  saveConflictResolution: (path, text) => invoke(Command.SaveConflictResolution, { path, text }),
  editorCommand: () => invoke(Command.EditorCommand),
  setEditorCommand: (command) => invoke(Command.SetEditorCommand, { command }),
  openInMergeTool: (path) => invoke(Command.OpenInMergeTool, { path }),
};
