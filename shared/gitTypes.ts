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

/** An operation that stopped part way, usually on a conflict. */
export type Operation = "merge" | "cherryPick" | "rebase" | "revert";

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
}

/** What the conflict editor shows for one file. */
export interface ConflictVersions {
  /**
   * Both sides merged by git, each conflict between `<<<<<<< current`,
   * `=======` and `>>>>>>> incoming` lines. Rebuilt from the index, so it is
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

/** A local branch. */
export interface GitBranch {
  name: string;
  current: boolean;
}

/** A file changed by a commit, relative to its first parent. */
export interface CommitFile {
  path: string;
  /** Previous path, set for renames ("R") and copies ("C"). */
  oldPath?: string;
  /** Single-letter git status code, e.g. "M", "A", "D", "R" or "C". */
  code: string;
}
