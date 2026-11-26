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
  watchRepository: () => invoke(Command.WatchRepository),
  repositoryState: () => invoke(Command.RepositoryState),
  fileDiff: (path, ignoreWhitespace) =>
    invoke(Command.FileDiff, { path, ignoreWhitespace }),
  fileText: (path, hash) => invoke(Command.FileText, { path, hash }),
  commitFiles: (hash, since) => invoke(Command.CommitFiles, { hash, since }),
  commitDiff: (hash, path, oldPath, ignoreWhitespace, since) =>
    invoke(Command.CommitDiff, { hash, path, oldPath, ignoreWhitespace, since }),
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
  stashChanges: (message, paths) => invoke(Command.StashChanges, { message, paths }),
  popStash: () => invoke(Command.PopStash),
  dropStash: (branch) => invoke(Command.DropStash, { branch }),
  imageVersions: (path, oldPath, hash, stash) =>
    invoke(Command.ImageVersions, { path, oldPath, hash, stash }),
  closeRepo: () => invoke(Command.CloseRepository),
  repoExists: (path) => invoke(Command.RepositoryExists, { path }),
  stashDiff: (hash, path, ignoreWhitespace) =>
    invoke(Command.StashDiff, { hash, path, ignoreWhitespace }),
  checkout: (branch) => invoke(Command.Checkout, { branch }),
  savedCommand: (which) => invoke(Command.SavedCommand, { which }),
  saveCommand: (which, command) => invoke(Command.SaveCommand, { which, command }),
  generateCommitMessage: () => invoke(Command.GenerateCommitMessage),
  gitHubAccount: () => invoke(Command.GitHubAccount),
  gitHubSignIn: () => invoke(Command.GitHubSignIn),
  gitHubSignInWithToken: (token) => invoke(Command.GitHubSignInWithToken, { token }),
  gitHubSignOut: () => invoke(Command.GitHubSignOut),
  gitHubRepositories: () => invoke(Command.GitHubRepositories),
  chooseFolder: () => invoke(Command.ChooseFolder),
  cloneRepository: (url, parent, name) => invoke(Command.CloneRepository, { url, parent, name }),
  addRemote: (name, url) => invoke(Command.AddRemote, { name, url }),
  // The Rust parameter is named `private`, which is reserved in TypeScript.
  publishRepository: (name, description, isPrivate) =>
    invoke(Command.PublishRepository, { name, description, private: isPrivate }),
  fetch: (background) => invoke(Command.Fetch, { background }),
  pull: () => invoke(Command.Pull),
  push: (force) => invoke(Command.Push, { force }),
  checkoutCommit: (hash) => invoke(Command.CheckoutCommit, { hash }),
  createBranch: (name, hash, checkout) => invoke(Command.CreateBranch, { name, hash, checkout }),
  createTag: (name, hash, message) => invoke(Command.CreateTag, { name, hash, message }),
  cherryPick: (hash, branch) => invoke(Command.CherryPick, { hash, branch }),
  openInBrowser: (url) => invoke(Command.OpenInBrowser, { url }),
  switchBranch: (name, changes) => invoke(Command.SwitchBranch, { name, changes }),
  revertCommit: (hash) => invoke(Command.RevertCommit, { hash }),
  resetToCommit: (hash, mode) => invoke(Command.ResetToCommit, { hash, mode }),
  squashCommits: (hashes, message) => invoke(Command.SquashCommits, { hashes, message }),
  deleteTag: (name, fromRemote) => invoke(Command.DeleteTag, { name, fromRemote }),
  pushTag: (name) => invoke(Command.PushTag, { name }),
  renameBranch: (name, newName) => invoke(Command.RenameBranch, { name, newName }),
  deleteBranch: (name, force) => invoke(Command.DeleteBranch, { name, force }),
  mergeBranch: (name) => invoke(Command.MergeBranch, { name }),
  rebaseOntoBranch: (name) => invoke(Command.RebaseOntoBranch, { name }),
  squashMergeBranch: (name, message) => invoke(Command.SquashMergeBranch, { name, message }),
  resolveConflict: (path, resolution) => invoke(Command.ResolveConflict, { path, resolution }),
  continueOperation: () => invoke(Command.ContinueOperation),
  abortOperation: () => invoke(Command.AbortOperation),
  aiResolveConflict: (path) => invoke(Command.AiResolveConflict, { path }),
  conflictVersions: (path) => invoke(Command.ConflictVersions, { path }),
  saveConflictResolution: (path, text) => invoke(Command.SaveConflictResolution, { path, text }),
  openInMergeTool: (path) => invoke(Command.OpenInMergeTool, { path }),
};
