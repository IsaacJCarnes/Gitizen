import type { GitBranch, GitCommit, GitStatus } from "./gitTypes";

export interface GitizenApi {
  openRepo(): Promise<string | null>;
  status(): Promise<GitStatus>;
  log(): Promise<GitCommit[]>;
  branches(): Promise<GitBranch[]>;
  diff(path: string, staged: boolean): Promise<string>;
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
