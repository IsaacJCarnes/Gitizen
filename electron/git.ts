import { ipcMain, dialog } from "electron";
import { simpleGit, SimpleGit } from "simple-git";

let git: SimpleGit | null = null;
const need = (): SimpleGit => {
  if (!git) throw new Error("No repository open");
  return git;
};

export function registerGitIpc(): void {
  ipcMain.handle("repo:open", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (res.canceled) return null;
    const dir = res.filePaths[0];
    const g = simpleGit(dir);
    if (!(await g.checkIsRepo()))
      throw new Error("That folder is not a git repository");
    git = g;
    return dir;
  });

  ipcMain.handle("git:status", async () => {
    const s = await need().status();
    return {
      branch: s.current,
      ahead: s.ahead,
      behind: s.behind,
      files: s.files.map((f) => ({
        path: f.path,
        staged: f.index !== " " && f.index !== "?",
        code: f.index.trim() || f.working_dir.trim(),
      })),
    };
  });

  ipcMain.handle("git:log", async () => {
    const l = await need().log({ maxCount: 100 });
    return l.all.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  });

  ipcMain.handle("git:branches", async () => {
    const b = await need().branchLocal();
    return b.all.map((name) => ({ name, current: name === b.current }));
  });

  ipcMain.handle("git:diff", async (_e, path: string, staged: boolean) =>
    need().diff(staged ? ["--cached", "--", path] : ["--", path]),
  );
  ipcMain.handle("git:stage", (_e, paths: string[]) => need().add(paths));
  ipcMain.handle("git:unstage", (_e, paths: string[]) =>
    need().reset(["HEAD", "--", ...paths]),
  );
  ipcMain.handle("git:commit", (_e, msg: string) => need().commit(msg));
  ipcMain.handle("git:checkout", (_e, branch: string) =>
    need().checkout(branch),
  );
}
