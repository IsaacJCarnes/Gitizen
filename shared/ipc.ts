/**
 * The contract between the Electron main process and the renderer.
 *
 * `IpcChannel` names every channel once so the main-process handlers
 * (electron/git/handlers.ts) and the preload bridge (electron/preload.ts)
 * can't drift apart. `GitizenApi` is the typed surface the preload script
 * exposes to the renderer as `window.gitizen`.
 */
import type {
  CommitFile,
  GitBranch,
  GitCommit,
  GitStatus,
} from "./gitTypes";

export const IpcChannel = {
  OpenRepository: "repo:open",
  Status: "git:status",
  Log: "git:log",
  Branches: "git:branches",
  Diff: "git:diff",
  CommitFiles: "git:commitFiles",
  CommitDiff: "git:commitDiff",
  Stage: "git:stage",
  Unstage: "git:unstage",
  Commit: "git:commit",
  Checkout: "git:checkout",
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

export interface GitizenApi {
  /** Shows a folder picker and opens the chosen repository. Resolves to its path, or null if cancelled. */
  openRepo(): Promise<string | null>;
  status(): Promise<GitStatus>;
  /** Up to 500 commits across all branches, remotes and tags, children before parents. */
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  /** Diff of one working-tree file, either its staged or its unstaged changes. */
  diff(path: string, staged: boolean): Promise<string>;
  /** Files changed by a commit, compared to its first parent. */
  commitFiles(hash: string): Promise<CommitFile[]>;
  /** Diff of one file in a commit, compared to its first parent. */
  commitDiff(hash: string, path: string, oldPath?: string): Promise<string>;
  stage(paths: string[]): Promise<unknown>;
  unstage(paths: string[]): Promise<unknown>;
  commit(message: string): Promise<unknown>;
  checkout(branch: string): Promise<unknown>;
}
