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
  FileDiff,
  GitBranch,
  GitCommit,
  GitStatus,
} from "./gitTypes";

export const Command = {
  OpenRepository: "open_repository",
  InitRepository: "init_repository",
  Status: "status",
  Log: "log",
  Branches: "branches",
  Diff: "diff",
  FileDiff: "file_diff",
  FileText: "file_text",
  CommitFiles: "commit_files",
  CommitDiff: "commit_diff",
  Stage: "stage",
  Unstage: "unstage",
  Commit: "commit",
  Checkout: "checkout",
  SetStagedLines: "set_staged_lines",
} as const;

export type CommandName = (typeof Command)[keyof typeof Command];

/**
 * Commands reject with git's message as a plain string, except opening a
 * repository, which rejects with this object (mirrors `OpenError` in
 * src-tauri/src/git/repository.rs) so the UI can offer `initRepo` for a
 * folder that isn't a repository yet.
 */
export type OpenRepositoryError =
  | { kind: "notARepository"; path: string; message: string }
  | { kind: "failed"; message: string };

export interface GitizenApi {
  /** Shows a folder picker and opens the chosen repository. Resolves to its path, or null if cancelled. */
  openRepo(): Promise<string | null>;
  /** Runs `git init` in `path` and opens it. Resolves to the path. */
  initRepo(path: string): Promise<string>;
  status(): Promise<GitStatus>;
  /** Up to 500 commits across all branches, remotes and tags, children before parents. */
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  /** Diff of one working-tree file, either its staged or its unstaged changes. */
  diff(path: string, staged: boolean, ignoreWhitespace?: boolean): Promise<string>;
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
  commit(message: string): Promise<void>;
  checkout(branch: string): Promise<void>;
}
