/**
 * The UI's bridge to the Rust backend: implements `GitizenApi` by calling
 * the Tauri commands in src-tauri/src/commands.rs.
 *
 * Tauri maps camelCase argument keys here to the snake_case parameter names
 * in Rust (e.g. `oldPath` -> `old_path`). A failed command rejects with git's
 * error message as a string.
 */
import { invoke } from "@tauri-apps/api/core";
import { Command, type GitizenApi } from "../../shared/ipc";

export const gitizen: GitizenApi = {
  openRepo: () => invoke(Command.OpenRepository),
  status: () => invoke(Command.Status),
  log: () => invoke(Command.Log),
  branches: () => invoke(Command.Branches),
  diff: (path, staged) => invoke(Command.Diff, { path, staged }),
  commitFiles: (hash) => invoke(Command.CommitFiles, { hash }),
  commitDiff: (hash, path, oldPath) =>
    invoke(Command.CommitDiff, { hash, path, oldPath }),
  stage: (paths) => invoke(Command.Stage, { paths }),
  unstage: (paths) => invoke(Command.Unstage, { paths }),
  commit: (message) => invoke(Command.Commit, { message }),
  checkout: (branch) => invoke(Command.Checkout, { branch }),
};
