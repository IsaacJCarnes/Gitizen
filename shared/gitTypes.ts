/**
 * Data shapes passed between the Electron main process and the renderer.
 *
 * Everything here crosses the IPC boundary, so it must stay plain,
 * serialisable data (no classes, functions or Dates).
 */

/** A file with uncommitted changes in the working tree or index. */
export interface FileChange {
  path: string;
  /** True when the change is in the index (staged), false for the working tree. */
  staged: boolean;
  /** Single-letter git status code, e.g. "M", "A", "D", "R" or "?". */
  code: string;
}

/** Snapshot of `git status` for the open repository. */
export interface GitStatus {
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null;
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
