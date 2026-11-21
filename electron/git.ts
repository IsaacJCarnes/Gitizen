import { ipcMain, dialog } from "electron";
import { simpleGit, SimpleGit } from "simple-git";

let git: SimpleGit | null = null;
const need = (): SimpleGit => {
  if (!git) throw new Error("No repository open");
  return git;
};

// git's well-known empty tree, used as the "parent" of a root commit.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const assertHash = (hash: string): string => {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error("Invalid commit hash");
  return hash;
};

// Diffs are shown against the first parent, so merges show what they brought in.
const parentOf = async (hash: string): Promise<string> => {
  const line = await need().raw(["rev-list", "--parents", "-n", "1", hash]);
  return line.trim().split(" ")[1] ?? EMPTY_TREE;
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
      body: c.body,
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
  ipcMain.handle("git:commitFiles", async (_e, hash: string) => {
    const parent = await parentOf(assertHash(hash));
    const out = await need().raw([
      "diff", "--name-status", "-z", "-M", parent, hash,
    ]);
    const parts = out.split("\0").filter(Boolean);
    const files: { path: string; oldPath?: string; code: string }[] = [];
    for (let i = 0; i < parts.length; ) {
      const status = parts[i];
      if (status.startsWith("R") || status.startsWith("C")) {
        files.push({ code: status[0], oldPath: parts[i + 1], path: parts[i + 2] });
        i += 3;
      } else {
        files.push({ code: status[0], path: parts[i + 1] });
        i += 2;
      }
    }
    return files;
  });

  ipcMain.handle(
    "git:commitDiff",
    async (_e, hash: string, path: string, oldPath?: string) => {
      const parent = await parentOf(assertHash(hash));
      const paths = oldPath ? [oldPath, path] : [path];
      return need().raw(["diff", "-M", parent, hash, "--", ...paths]);
    },
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
