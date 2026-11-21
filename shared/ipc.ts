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
  GitBranch,
  GitCommit,
  GitStatus,
} from "./gitTypes";

export const Command = {
  OpenRepository: "open_repository",
  Status: "status",
  Log: "log",
  Branches: "branches",
  Diff: "diff",
  FileDiff: "file_diff",
  CommitFiles: "commit_files",
  CommitDiff: "commit_diff",
  Stage: "stage",
  Unstage: "unstage",
  Commit: "commit",
  Checkout: "checkout",
} as const;

export type CommandName = (typeof Command)[keyof typeof Command];

export interface GitizenApi {
  /** Shows a folder picker and opens the chosen repository. Resolves to its path, or null if cancelled. */
  openRepo(): Promise<string | null>;
  status(): Promise<GitStatus>;
  /** Up to 500 commits across all branches, remotes and tags, children before parents. */
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  /** Diff of one working-tree file, either its staged or its unstaged changes. */
  diff(path: string, staged: boolean): Promise<string>;
  /**
   * Every uncommitted change to one file (staged and unstaged together)
   * against HEAD, so it reads the same whether or not the file is staged.
   */
  fileDiff(path: string): Promise<string>;
  /** Files changed by a commit, compared to its first parent. */
  commitFiles(hash: string): Promise<CommitFile[]>;
  /** Diff of one file in a commit, compared to its first parent. */
  commitDiff(hash: string, path: string, oldPath?: string): Promise<string>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  checkout(branch: string): Promise<void>;
}
