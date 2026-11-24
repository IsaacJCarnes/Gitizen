/**
 * The contract between the Rust backend (src-tauri) and the UI.
 *
 * `Command` names every Tauri command once, so the UI bridge
 * (src/api/gitizen.ts) can't drift from the names registered in
 * src-tauri/src/lib.rs. `GitizenApi` is the typed surface that bridge
 * exports as `gitizen`.
 */
import type {
  ChangesOnSwitch,
  CommitFile,
  ConflictState,
  ConflictVersions,
  ExternalTool,
  FileDiff,
  GitHubAccount,
  GitHubRepository,
  GitBranch,
  GitCommit,
  GitStatus,
  Remote,
  ResetMode,
  Resolution,
  SavedCommandKind,
  BranchStash,
  StashOutcome,
} from "./gitTypes";

export const Command = {
  OpenRepository: "open_repository",
  InitRepository: "init_repository",
  OpenRepositoryAt: "open_repository_at",
  RecentRepositories: "recent_repositories",
  RememberRepository: "remember_repository",
  ForgetRepository: "forget_repository",
  WatchRepository: "watch_repository",
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
  BranchStash: "branch_stash",
  PopStash: "pop_stash",
  DropStash: "drop_stash",
  StashDiff: "stash_diff",
  Checkout: "checkout",
  SetStagedLines: "set_staged_lines",
  DiscardFiles: "discard_files",
  DiscardLines: "discard_lines",
  CanEditFile: "can_edit_file",
  WorkingFile: "working_file",
  SaveWorkingFile: "save_working_file",
  SavedCommand: "saved_command",
  SaveCommand: "save_command",
  GenerateCommitMessage: "generate_commit_message",
  GitHubAccount: "github_account",
  GitHubSignIn: "github_sign_in",
  GitHubSignInWithToken: "github_sign_in_with_token",
  GitHubSignOut: "github_sign_out",
  GitHubRepositories: "github_repositories",
  ChooseFolder: "choose_folder",
  CloneRepository: "clone_repository",
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
  SwitchBranch: "switch_branch",
  RewritableCommits: "rewritable_commits",
  RevertCommit: "revert_commit",
  ResetToCommit: "reset_to_commit",
  SquashCommits: "squash_commits",
  ReorderCommits: "reorder_commits",
  DeleteTag: "delete_tag",
  PushTag: "push_tag",
  RenameBranch: "rename_branch",
  DeleteBranch: "delete_branch",
  MergeBranch: "merge_branch",
  RebaseOntoBranch: "rebase_onto_branch",
  SquashMergeBranch: "squash_merge_branch",
  Conflicts: "conflicts",
  ResolveConflict: "resolve_conflict",
  ContinueOperation: "continue_operation",
  AbortOperation: "abort_operation",
  AiResolveConflict: "ai_resolve_conflict",
  ConflictVersions: "conflict_versions",
  SaveConflictResolution: "save_conflict_resolution",
  OpenInMergeTool: "open_in_merge_tool",
} as const;

/** The event the backend sends when the watched repository changed on disk. */
export const REPOSITORY_CHANGED = "repository-changed";

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
  /**
   * Starts watching the open repository's files (instead of any earlier
   * one). After each burst of changes that matters (not ignored files, not
   * git's object store) the window gets the `REPOSITORY_CHANGED` event.
   */
  watchRepository(): Promise<void>;
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
  /**
   * Files changed by a commit, compared to its first parent. With `since`
   * (an older commit), every change from `since` through `hash` together:
   * compared to the first parent of `since`.
   */
  commitFiles(hash: string, since?: string): Promise<CommitFile[]>;
  /** Diff of one file in a commit (or from `since` through it), as for `commitFiles`. */
  commitDiff(
    hash: string,
    path: string,
    oldPath?: string,
    ignoreWhitespace?: boolean,
    since?: string,
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
  /**
   * Stashes `paths` (every change when left out), untracked files too, on
   * the current branch. A branch keeps one stash: when it has one already,
   * the changes are added to it, which may stop on conflicts between the two
   * ("conflicts") for the conflict editor, to finish with
   * `continueOperation` or undo with `abortOperation`.
   */
  stashChanges(message: string, paths?: string[]): Promise<StashOutcome>;
  /** The current branch's stash, or null if it has none. */
  branchStash(): Promise<BranchStash | null>;
  /**
   * Applies the current branch's stash and drops it (needs nothing staged).
   * Stops on conflicts with the branch like `stashChanges`.
   */
  popStash(): Promise<StashOutcome>;
  /** Deletes the current branch's stash for good. */
  dropStash(): Promise<void>;
  /** Diff of one file in stash `hash` against the commit it was made on (untracked files show as new). */
  stashDiff(hash: string, path: string, ignoreWhitespace?: boolean): Promise<string>;
  checkout(branch: string): Promise<void>;
  /**
   * A command line saved in Gitizen's settings (the AI commit message or
   * resolve command, e.g. `claude -p`, or the external merge tool, e.g.
   * `code {file}`), or "" if none is set up.
   */
  savedCommand(which: SavedCommandKind): Promise<string>;
  /** Saves a command line (trimmed; "" clears it). Resolves to what was saved. */
  saveCommand(which: SavedCommandKind, command: string): Promise<string>;
  /**
   * Pipes a prompt plus the staged diff to the saved AI command and splits
   * what it prints into summary and description. Stages and commits nothing.
   */
  generateCommitMessage(): Promise<GeneratedCommitMessage>;
  /**
   * The signed-in GitHub account, or null. A sign-in git's credential helper
   * saved earlier (Git Credential Manager on Windows) counts, so this signs
   * in by itself when one exists.
   */
  gitHubAccount(): Promise<GitHubAccount | null>;
  /**
   * Signs in to GitHub through git's credential helper, which shows its own
   * sign-in window (Git Credential Manager: in the browser). The sign-in is
   * kept by the helper, for git's own pushes too.
   */
  gitHubSignIn(): Promise<GitHubAccount>;
  /** Signs in with a personal access token (checked with GitHub, then saved like any sign-in). */
  gitHubSignInWithToken(token: string): Promise<GitHubAccount>;
  /** Signs out, removing the GitHub sign-in from git's credential helper too. */
  gitHubSignOut(): Promise<void>;
  /** The signed-in account's repositories (its own, collaborations and organizations'), most recently updated first. */
  gitHubRepositories(): Promise<GitHubRepository[]>;
  /** Shows a folder picker. Resolves to the chosen folder, or null if cancelled. */
  chooseFolder(): Promise<string | null>;
  /**
   * Clones `url` into a new (or empty) folder `name` inside `parent`, and
   * opens it like `openRepoAt`. Resolves to the clone's path.
   */
  cloneRepository(url: string, parent: string, name: string): Promise<string>;
  /** Every configured remote with its URL. */
  remotes(): Promise<Remote[]>;
  /** Adds a remote (normally `origin`) pointing at an existing repository URL. */
  addRemote(name: string, url: string): Promise<void>;
  /**
   * Creates a repository on the signed-in GitHub account, adds it as
   * `origin` and pushes the current branch. Rejects when signed out.
   */
  publishRepository(name: string, description: string, isPrivate: boolean): Promise<void>;
  /**
   * Fetches every remote and prunes deleted remote branches. A `background`
   * fetch never shows a sign-in window (it fails instead).
   */
  fetch(background?: boolean): Promise<void>;
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
  /**
   * Switches to local branch `name`, first leaving any uncommitted changes
   * on the current branch (stashed, which may stop on conflicts with its
   * stash like `stashChanges`, without switching) or bringing them along
   * (rejects, changing nothing, when `name` changes the same files).
   */
  switchBranch(name: string, changes: ChangesOnSwitch): Promise<StashOutcome>;
  /**
   * The commits history may be rewritten for (squashed, reordered), newest
   * first: the checked-out branch's own commits from its tip back to the
   * first merge or the first commit another branch, a tag or a remote
   * branch also has. Empty on a detached HEAD.
   */
  rewritableCommits(): Promise<string[]>;
  /**
   * Adds a commit to the current branch that undoes `hash` (a merge against
   * its first parent). Needs a clean working tree; conflicts stop it for the
   * conflict editor.
   */
  revertCommit(hash: string): Promise<void>;
  /** Moves the current branch back to `hash`, an earlier commit of it (see `ResetMode`). */
  resetToCommit(hash: string, mode: ResetMode): Promise<void>;
  /**
   * Squashes `hashes`, rewritable commits next to each other, into one
   * commit with `message` (the oldest's author), replaying later commits on top.
   */
  squashCommits(hashes: string[], message: string): Promise<void>;
  /**
   * Puts the branch's newest rewritable commits in a new order: `order`
   * lists all of the newest `order.length` of them, oldest first. Conflicts
   * stop the rebase for the conflict editor.
   */
  reorderCommits(order: string[]): Promise<void>;
  /** Deletes a tag, and with `fromRemote` from the remote (origin, or the only one) first. */
  deleteTag(name: string, fromRemote: boolean): Promise<void>;
  /** Pushes a tag to the remote (origin, or the only one). */
  pushTag(name: string): Promise<void>;
  /** Renames a local branch; its upstream setting moves with it. */
  renameBranch(name: string, newName: string): Promise<void>;
  /**
   * Deletes a local branch other than the checked-out one. Without `force`,
   * rejects if it has commits that aren't merged anywhere else.
   */
  deleteBranch(name: string, force: boolean): Promise<void>;
  /** Merges `name` into the current branch; stopping on conflicts resolves (the conflict editor takes over). */
  mergeBranch(name: string): Promise<void>;
  /** Rebases the current branch onto `name` (needs a clean working tree); stopping on conflicts resolves. */
  rebaseOntoBranch(name: string): Promise<void>;
  /**
   * Squashes every change of `name` into one new commit on the current
   * branch with `message`. On conflicts, resolves with them left to resolve
   * and the message kept for the commit that finishes it.
   */
  squashMergeBranch(name: string, message: string): Promise<void>;
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
  /** Both sides of a conflicted file merged with conflict markers, plus the file as it is now. */
  conflictVersions(path: string): Promise<ConflictVersions>;
  /** Writes `text` to a conflicted file (keeping its line endings), without staging it. */
  saveConflictResolution(path: string, text: string): Promise<void>;
  /**
   * Opens a conflicted file in the saved command, else git's `merge.tool`
   * (waiting until it closes), else the system text editor.
   */
  openInMergeTool(path: string): Promise<ExternalTool>;
}
