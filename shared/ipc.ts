/**
 * The contract between the Rust backend (src-tauri) and the UI.
 *
 * `Command` names every Tauri command once, so the UI bridge
 * (src/api/gitizen.ts) can't drift from the names registered in
 * src-tauri/src/lib.rs. `GitizenApi` is the typed surface that bridge
 * exports as `gitizen`.
 */
import type {
  CommitFile,
  ConflictState,
  ConflictVersions,
  ExternalTool,
  FileDiff,
  GitBranch,
  GitCommit,
  GitStatus,
  Remote,
  Resolution,
} from "./gitTypes";

export const Command = {
  OpenRepository: "open_repository",
  InitRepository: "init_repository",
  OpenRepositoryAt: "open_repository_at",
  RecentRepositories: "recent_repositories",
  RememberRepository: "remember_repository",
  ForgetRepository: "forget_repository",
  Status: "status",
  Log: "log",
  Branches: "branches",
  FileDiff: "file_diff",
  FileText: "file_text",
  CommitFiles: "commit_files",
  CommitDiff: "commit_diff",
  Stage: "stage",
  Unstage: "unstage",
  Commit: "commit",
  UndoLastCommit: "undo_last_commit",
  StashChanges: "stash_changes",
  Checkout: "checkout",
  SetStagedLines: "set_staged_lines",
  DiscardFiles: "discard_files",
  DiscardLines: "discard_lines",
  CanEditFile: "can_edit_file",
  WorkingFile: "working_file",
  SaveWorkingFile: "save_working_file",
  AiCommitCommand: "ai_commit_command",
  SetAiCommitCommand: "set_ai_commit_command",
  GenerateCommitMessage: "generate_commit_message",
  Remotes: "remotes",
  AddRemote: "add_remote",
  PublishRepository: "publish_repository",
  Fetch: "fetch",
  Pull: "pull",
  Push: "push",
  CheckoutCommit: "checkout_commit",
  CreateBranch: "create_branch",
  CreateTag: "create_tag",
  CherryPick: "cherry_pick",
  OpenInBrowser: "open_in_browser",
  Conflicts: "conflicts",
  ResolveConflict: "resolve_conflict",
  ContinueOperation: "continue_operation",
  AbortOperation: "abort_operation",
  AiResolveCommand: "ai_resolve_command",
  SetAiResolveCommand: "set_ai_resolve_command",
  AiResolveConflict: "ai_resolve_conflict",
  ConflictVersions: "conflict_versions",
  SaveConflictResolution: "save_conflict_resolution",
  EditorCommand: "editor_command",
  SetEditorCommand: "set_editor_command",
  OpenInMergeTool: "open_in_merge_tool",
} as const;

export type CommandName = (typeof Command)[keyof typeof Command];

/**
 * Commands reject with git's message as a plain string, except opening a
 * repository (`openRepo`, `openRepoAt`), which rejects with this object (mirrors `OpenError` in
 * src-tauri/src/git/repository.rs) so the UI can offer `initRepo` for a
 * folder that isn't a repository yet.
 */
export type OpenRepositoryError =
  | { kind: "notARepository"; path: string; message: string }
  | { kind: "failed"; message: string };

/** A commit message split the way the commit form shows it. */
export interface GeneratedCommitMessage {
  summary: string;
  description: string;
}

export interface GitizenApi {
  /** Shows a folder picker and opens the chosen repository. Resolves to its path, or null if cancelled. */
  openRepo(): Promise<string | null>;
  /** Runs `git init` in `path` and opens it. Resolves to the path. */
  initRepo(path: string): Promise<string>;
  /** Opens the repository at `path` without a picker. Resolves to the path; rejects with an `OpenRepositoryError` like `openRepo`. */
  openRepoAt(path: string): Promise<string>;
  /** Saved repository paths, most recent first. */
  recentRepos(): Promise<string[]>;
  /** Moves `path` to the top of the saved list (adding it if new). Resolves to the new list. */
  rememberRepo(path: string): Promise<string[]>;
  /** Removes `path` from the saved list. Resolves to the new list. */
  forgetRepo(path: string): Promise<string[]>;
  status(): Promise<GitStatus>;
  /** Up to 500 commits across all branches, remotes and tags, children before parents. */
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  /**
   * Every uncommitted change to one file (staged and unstaged together)
   * against HEAD, so it reads the same whether or not the file is staged,
   * plus which of its changed lines are staged.
   */
  fileDiff(path: string, ignoreWhitespace?: boolean): Promise<FileDiff>;
  /**
   * A file's text as the new side of its diff: at commit `hash`, or in the
   * working tree when `hash` is left out. Used to expand the lines a diff
   * hides between hunks. Empty if the file doesn't exist there.
   */
  fileText(path: string, hash?: string): Promise<string>;
  /** Files changed by a commit, compared to its first parent. */
  commitFiles(hash: string): Promise<CommitFile[]>;
  /** Diff of one file in a commit, compared to its first parent. */
  commitDiff(
    hash: string,
    path: string,
    oldPath?: string,
    ignoreWhitespace?: boolean,
  ): Promise<string>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  /**
   * Stages (`staged` true) or unstages (`staged` false) single lines of one
   * file. `diff` is the text `fileDiff(path)` returned, with whitespace
   * shown, and `lines` are indices into `diff.split("\n")` of its + and -
   * lines. Rejects without changing anything if the file changed since.
   */
  setStagedLines(path: string, diff: string, lines: number[], staged: boolean): Promise<void>;
  /**
   * Puts files back as they are in HEAD (staged and unstaged changes alike),
   * deleting files HEAD doesn't have. Pass both paths of a rename.
   */
  discardFiles(paths: string[]): Promise<void>;
  /**
   * Throws away single changed lines of one file, in the working tree and
   * the index. `diff` and `lines` are as for `setStagedLines`; rejects
   * without changing anything if the file changed since.
   */
  discardLines(path: string, diff: string, lines: number[]): Promise<void>;
  /** True when `path` is a text file in the working directory small enough to edit. */
  canEditFile(path: string): Promise<boolean>;
  /** The working-tree file's text with "
" line endings; rejects for binary, missing or huge files. */
  workingFile(path: string): Promise<string>;
  /** Overwrites the working-tree file with `text` (keeping its line endings), without staging it. */
  saveWorkingFile(path: string, text: string): Promise<void>;
  /**
   * Commits the staged changes. With `amend`, replaces the last commit with
   * its changes plus what is staged now, under `message`.
   */
  commit(message: string, amend?: boolean): Promise<void>;
  /** Undoes the last commit, keeping its changes staged. Rejects for merge commits. */
  undoLastCommit(): Promise<void>;
  /** Stashes every uncommitted change (untracked files too), leaving a clean working tree. */
  stashChanges(message: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  /** The saved AI command line tool for commit messages (e.g. `claude -p`), or "" if none is set up. */
  aiCommitCommand(): Promise<string>;
  /** Saves the AI command (trimmed; "" clears it). Resolves to what was saved. */
  setAiCommitCommand(command: string): Promise<string>;
  /**
   * Pipes a prompt plus the staged diff to the saved AI command and splits
   * what it prints into summary and description. Stages and commits nothing.
   */
  generateCommitMessage(): Promise<GeneratedCommitMessage>;
  /** Every configured remote with its URL. */
  remotes(): Promise<Remote[]>;
  /** Adds a remote (normally `origin`) pointing at an existing repository URL. */
  addRemote(name: string, url: string): Promise<void>;
  /**
   * Creates a GitHub repository with the GitHub CLI (`gh`), adds it as
   * `origin` and pushes the current branch. Rejects with gh's message (or
   * install instructions when gh is missing).
   */
  publishRepository(name: string, description: string, isPrivate: boolean): Promise<void>;
  /** Fetches every remote and prunes deleted remote branches. */
  fetch(): Promise<void>;
  /** Pulls the current branch's upstream into it (a merge unless `pull.rebase` is set). */
  pull(): Promise<void>;
  /**
   * Pushes the current branch, publishing it to `origin` with tracking if it
   * has no upstream yet. `force` overwrites the remote branch (with lease),
   * for after amending or undoing a pushed commit.
   */
  push(force?: boolean): Promise<void>;
  /** Checks out a commit itself, leaving HEAD detached. */
  checkoutCommit(hash: string): Promise<void>;
  /** Creates branch `name` at commit `hash`, switching to it when `checkout`. */
  createBranch(name: string, hash: string, checkout: boolean): Promise<void>;
  /** Creates an annotated tag at `hash`; an empty `message` uses the tag name. */
  createTag(name: string, hash: string, message: string): Promise<void>;
  /**
   * Applies commit `hash` onto `branch` as a new commit, switching to that
   * branch first (which needs a clean working tree) and staying on it.
   */
  cherryPick(hash: string, branch: string): Promise<void>;
  /** Opens a https://github.com/ page in the default browser (other URLs are refused). */
  openInBrowser(url: string): Promise<void>;
  /** The stopped merge, cherry-pick, rebase or revert (if any) and its unresolved files. */
  conflicts(): Promise<ConflictState>;
  /** Settles one conflicted file (our version, theirs, or as it is now) and stages it. */
  resolveConflict(path: string, resolution: Resolution): Promise<void>;
  /** Finishes the stopped operation once every file is resolved. */
  continueOperation(): Promise<void>;
  /** Abandons the stopped operation, restoring the state from before it began. */
  abortOperation(): Promise<void>;
  /**
   * Has the saved AI command resolve one conflicted file and resolves to its
   * answer, without writing anything. Rejects if the answer is empty or
   * still has conflict markers.
   */
  aiResolveConflict(path: string): Promise<string>;
  /** The saved AI command for resolving conflicts (separate from the commit one), or "" if none is set up. */
  aiResolveCommand(): Promise<string>;
  /** Saves the AI resolve command (trimmed; "" clears it). Resolves to what was saved. */
  setAiResolveCommand(command: string): Promise<string>;
  /** Both sides of a conflicted file merged with conflict markers, plus the file as it is now. */
  conflictVersions(path: string): Promise<ConflictVersions>;
  /** Writes `text` to a conflicted file (keeping its line endings), without staging it. */
  saveConflictResolution(path: string, text: string): Promise<void>;
  /** The external tool command for conflicted files, e.g. `code {file}`; "" when none is set. */
  editorCommand(): Promise<string>;
  /** Saves the external tool command (trimmed; "" clears it). Resolves to what was saved. */
  setEditorCommand(command: string): Promise<string>;
  /**
   * Opens a conflicted file in the saved command, else git's `merge.tool`
   * (waiting until it closes), else the system text editor.
   */
  openInMergeTool(path: string): Promise<ExternalTool>;
}
