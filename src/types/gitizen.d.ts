import type {
  CommitFile,
  GitBranch,
  GitCommit,
  GitStatus,
} from "./git";

export interface GitizenApi {
  openRepo(): Promise<string | null>;
  status(): Promise<GitStatus>;
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  diff(path: string, staged: boolean): Promise<string>;
  commitFiles(hash: string): Promise<CommitFile[]>;
  commitDiff(hash: string, path: string, oldPath?: string): Promise<string>;
  stage(paths: string[]): Promise<unknown>;
  unstage(paths: string[]): Promise<unknown>;
  commit(msg: string): Promise<unknown>;
  checkout(branch: string): Promise<unknown>;
}

declare global {
  interface Window {
    gitizen: GitizenApi;
  }
}
