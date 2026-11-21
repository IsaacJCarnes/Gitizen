/**
 * IPC handlers that expose git operations to the renderer. Each handler maps
 * one `IpcChannel` to a git command on the open repository; the renderer
 * calls them through `window.gitizen` (see electron/preload.ts).
 */
import { ipcMain, dialog } from "electron";
import { IpcChannel } from "../../shared/ipc";
import type { GitBranch, GitStatus } from "../../shared/gitTypes";
import { LOG_FORMAT, parseLog, parseNameStatus } from "./parsers";
import {
  assertHash,
  firstParentOf,
  openRepository,
  requireRepository as repo,
} from "./repository";

/** Registers every git IPC handler. Call once, after the app is ready. */
export function registerGitIpc(): void {
  ipcMain.handle(IpcChannel.OpenRepository, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled) return null;
    const directory = result.filePaths[0];
    await openRepository(directory);
    return directory;
  });

  ipcMain.handle(IpcChannel.Status, async (): Promise<GitStatus> => {
    const status = await repo().status();
    return {
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      files: status.files.map((file) => ({
        path: file.path,
        staged: file.index !== " " && file.index !== "?",
        code: file.index.trim() || file.working_dir.trim(),
      })),
    };
  });

  // Every branch, remote and tag (stashes excluded), newest first with
  // children always before parents, which is what the commit graph needs.
  ipcMain.handle(IpcChannel.Log, async () => {
    const output = await repo().raw([
      "log",
      "--decorate=full",
      "--exclude=refs/stash",
      "--all",
      "--date-order",
      "--max-count=500",
      `--format=${LOG_FORMAT}`,
    ]);
    return parseLog(output);
  });

  ipcMain.handle(IpcChannel.Branches, async (): Promise<GitBranch[]> => {
    const branches = await repo().branchLocal();
    return branches.all.map((name) => ({ name, current: name === branches.current }));
  });

  ipcMain.handle(IpcChannel.Diff, (_event, path: string, staged: boolean) =>
    repo().diff(staged ? ["--cached", "--", path] : ["--", path]),
  );

  ipcMain.handle(IpcChannel.CommitFiles, async (_event, hash: string) => {
    const parent = await firstParentOf(assertHash(hash));
    const output = await repo().raw([
      "diff", "--name-status", "-z", "-M", parent, hash,
    ]);
    return parseNameStatus(output);
  });

  ipcMain.handle(
    IpcChannel.CommitDiff,
    async (_event, hash: string, path: string, oldPath?: string) => {
      const parent = await firstParentOf(assertHash(hash));
      const paths = oldPath ? [oldPath, path] : [path];
      return repo().raw(["diff", "-M", parent, hash, "--", ...paths]);
    },
  );

  ipcMain.handle(IpcChannel.Stage, (_event, paths: string[]) => repo().add(paths));

  ipcMain.handle(IpcChannel.Unstage, (_event, paths: string[]) =>
    repo().reset(["HEAD", "--", ...paths]),
  );

  ipcMain.handle(IpcChannel.Commit, (_event, message: string) =>
    repo().commit(message),
  );

  ipcMain.handle(IpcChannel.Checkout, (_event, branch: string) =>
    repo().checkout(branch),
  );
}
