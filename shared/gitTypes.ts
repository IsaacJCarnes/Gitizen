/**
 * Data shapes passed between the Rust backend and the UI (mirrored in
 * src-tauri/src/git/types.rs).
 *
 * Everything here crosses the IPC boundary, so it must stay plain,
 * serialisable data (no classes, functions or Dates).
 */

/** A file with uncommitted changes in the working tree or index. */
export interface FileChange {
  path: string;
  /** Previous path, set for renames ("R") and copies ("C"). */
  oldPath?: string;
  /** True when the change is in the index (staged), false for the working tree. */
  staged: boolean;
  /** Single-letter git status code, e.g. "M", "A", "D", "R" or "?". */
  code: string;
}

/** The combined diff of one working-tree file and which of its lines are staged. */
export interface FileDiff {
  /** Unified diff from HEAD to the working tree, staged and unstaged changes together. */
  diff: string;
  /** Indices into `diff.split("\n")` of the added and removed lines that are in the index. */
  stagedLines: number[];
}

/** Snapshot of `git status` for the open repository. */
export interface GitStatus {
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null;
  /** The branch it tracks, e.g. "origin/main"; absent when it tracks none. */
  upstream?: string;
  ahead: number;
  behind: number;
  files: FileChange[];
}

/** A ref (branch, remote branch, tag or detached HEAD) pointing at a commit. */
export interface GitRef {
  name: string;
  type: "branch" | "remote" | "tag" | "head";
  /** True for the ref HEAD currently points at. */
  current?: boolean;
}

/** One commit from `git log`. */
export interface GitCommit {
  hash: string;
  /** Parent hashes; the first one is the first parent. Empty for root commits. */
  parents: string[];
  refs: GitRef[];
  /** Commit subject (first line of the message). */
  message: string;
  /** Rest of the commit message after the subject, trimmed. */
  body: string;
  author: string;
  /** Author date in ISO 8601 format. */
  date: string;
}

/** A configured remote, e.g. `origin` and its fetch URL. */
export interface Remote {
  name: string;
  url: string;
}

/**
 * An operation that stopped part way, usually on a conflict. "squash" is a
 * squash merge, whose changes wait to be committed as one commit. "stash"
 * is adding changes to the branch's stash and "stashPop" popping it, both
 * stopped because the stash conflicts; they finish without a commit.
 */
export type Operation = "merge" | "cherryPick" | "rebase" | "revert" | "squash" | "stash" | "stashPop";

/** A file git couldn't merge by itself. */
export interface ConflictFile {
  path: string;
  /** git's two-letter unmerged status: "UU" both changed, "AA" both added, "UD" deleted by them, "DU" deleted by us, and so on. */
  code: string;
  /** True while the file still has `<<<<<<<` / `>>>>>>>` markers. */
  hasMarkers: boolean;
}

/** The repository's conflict state; `operation` is null when nothing is in progress. */
export interface ConflictState {
  operation: Operation | null;
  /** Files still unresolved. */
  files: ConflictFile[];
  /** The commit message git prepared for finishing it (e.g. "Merge branch 'side'"), or null. */
  message: string | null;
  /** What is being brought in: a branch name, "side~2", or a short hash. Null when nothing is in progress. */
  incoming: string | null;
  /** The branch it is being brought into (the branch being rebased, for a rebase), or a short hash. */
  current: string | null;
  /** For a rebase, which of its commits it is replaying (e.g. 2 of 3); null otherwise. */
  step: { current: number; total: number } | null;
}

/** What the conflict editor shows for one file. */
export interface ConflictVersions {
  /**
   * Both sides merged by git, each conflict between `   * `=======` and `>>>>>>> incoming` lines. Rebuilt from the index, so it is
   * still there after a resolution was saved.
   */
  merged: string;
  /** The working-tree file now (e.g. a resolution saved earlier), or null if it doesn't exist. */
  working: string | null;
  /** True when either side is binary; such files can only take one side. */
  binary: boolean;
}

/** The external tool a conflicted file was opened in: git's merge tool (waited for) or an editor. */
export type ExternalTool = "mergeTool" | "editor";

/** How to settle a conflicted file: our side, their side, or the file as it is now. */
export type Resolution = "ours" | "theirs" | "asIs";

/**
 * A command line saved in Gitizen's settings (mirrors `SavedCommand` in
 * src-tauri/src/settings.rs): the AI commands for commit messages and for
 * resolving conflicts, and the external tool that opens conflicted files.
 */
export type SavedCommandKind = "aiCommit" | "aiResolve" | "editor";

/** A branch's stash (Gitizen keeps one per branch). */
export interface BranchStash {
  /** The stash commit's hash. */
  hash: string;
  /** The branch it was made on. */
  branch: string;
  /** The commit it was made on. */
  base: string;
  /**
   * Where the history graph attaches it: `base` while the branch still has
   * that commit, else the branch's tip (the commit was undone or amended),
   * so the stash stays with its branch.
   */
  anchor: string;
  /** Its message, without git's "On <branch>: " prefix. */
  message: string;
  /** The files it changes, untracked ones included. */
  files: CommitFile[];
}

/**
 * What switching branches does with uncommitted changes: "leave" stashes
 * them on the branch being left, "bring" carries them to the other branch.
 */
export type ChangesOnSwitch = "leave" | "bring";

/** What stashing or popping did: finished, or stopped on conflicts to resolve. */
export type StashOutcome = "done" | "conflicts";

/** The GitHub account Gitizen is signed in to. */
export interface GitHubAccount {
  login: string;
  /** The profile's display name, or null when it has none. */
  name: string | null;
  avatarUrl: string;
}

/** One of the signed-in account's GitHub repositories, as listed for cloning. */
export interface GitHubRepository {
  /** "owner/name". */
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  /** The https URL to clone. */
  cloneUrl: string;
  /** When it last changed, in ISO 8601. */
  updatedAt: string;
}

/**
 * How far resetting a branch to an earlier commit goes: "soft" keeps the
 * dropped commits' changes staged, "mixed" keeps them unstaged, "hard"
 * throws them away along with any uncommitted changes.
 */
export type ResetMode = "soft" | "mixed" | "hard";

/**
 * Both sides of an image's change as `data:` URLs, for the image diff
 * viewer. A side is null when the file doesn't exist there.
 */
export interface ImageVersions {
  old: string | null;
  new: string | null;
}

/** A local branch. */
export interface GitBranch {
  name: string;
  current: boolean;
  /** Commits on this branch that the checked-out commit (HEAD) doesn't have. */
  ahead: number;
  /** Commits HEAD has that this branch doesn't. */
  behind: number;
}

/** A file changed by a commit, relative to its first parent. */
export interface CommitFile {
  path: string;
  /** Previous path, set for renames ("R") and copies ("C"). */
  oldPath?: string;
  /** Single-letter git status code, e.g. "M", "A", "D", "R" or "C". */
  code: string;
}

/**
 * Everything the window shows about the open repository, loaded together
 * for each refresh (mirrors `RepositoryState` in src-tauri/src/state.rs).
 */
export interface RepositoryState {
  status: GitStatus;
  /** Up to 500 commits across all branches, remotes and tags, children before parents. */
  commits: GitCommit[];
  /** Local branches, with how far each is ahead of and behind HEAD. */
  branches: GitBranch[];
  /** Configured remotes; empty until the repository is published or a remote is added. */
  remotes: Remote[];
  /** The stopped merge, cherry-pick, rebase, revert or stash operation (if any) and its unresolved files. */
  conflicts: ConflictState;
  /** Every branch's stash (the newest made on each branch). */
  stashes: BranchStash[];
  /**
   * The commits history may be rewritten for (squashed), newest first: the
   * checked-out branch's own commits from its tip back to the first merge or
   * the first commit another branch, a tag or a remote branch also has.
   * Empty on a detached HEAD.
   */
  rewritable: string[];
}
