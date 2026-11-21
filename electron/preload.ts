/**
 * Preload script: runs in an isolated context before the renderer and
 * exposes a small, typed git API as `window.gitizen`. The renderer never gets
 * direct access to `ipcRenderer` or Node.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type GitizenApi, type IpcChannelName } from "../shared/ipc";

const invoke = (channel: IpcChannelName, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args);

const api: GitizenApi = {
  openRepo: () => invoke(IpcChannel.OpenRepository),
  status: () => invoke(IpcChannel.Status),
  log: () => invoke(IpcChannel.Log),
  branches: () => invoke(IpcChannel.Branches),
  diff: (path, staged) => invoke(IpcChannel.Diff, path, staged),
  commitFiles: (hash) => invoke(IpcChannel.CommitFiles, hash),
  commitDiff: (hash, path, oldPath) =>
    invoke(IpcChannel.CommitDiff, hash, path, oldPath),
  stage: (paths) => invoke(IpcChannel.Stage, paths),
  unstage: (paths) => invoke(IpcChannel.Unstage, paths),
  commit: (message) => invoke(IpcChannel.Commit, message),
  checkout: (branch) => invoke(IpcChannel.Checkout, branch),
};

contextBridge.exposeInMainWorld("gitizen", api);
