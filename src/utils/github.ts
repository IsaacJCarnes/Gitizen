/** Turning remote URLs into github.com web pages. */
import type { Remote } from "../../shared/gitTypes";

/**
 * The github.com page of a remote URL in any of git's forms, e.g.
 * "https://github.com/o/r.git", "git@github.com:o/r.git" or
 * "ssh://git@github.com/o/r", as "https://github.com/o/r". Undefined for
 * anything that isn't a github.com repository.
 */
export function githubRepoPage(url: string): string | undefined {
  // Host is github.com, preceded by the start, "//" or "user@", and
  // followed by ":" (scp-like SSH) or "/" (or ":port/"); then "owner/repo".
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?github\.com(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
    url.trim(),
  );
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

/**
 * The github.com page of `hash`, from the first GitHub remote: the one the
 * current branch tracks (from `upstream`, e.g. "origin/main"), then
 * `origin`, then any other.
 */
export function githubCommitPage(
  remotes: Remote[],
  upstream: string | undefined,
  hash: string,
): string | undefined {
  // Ranks each remote: 0 the tracked one, 1 origin, 2 the rest. `sort` is
  // stable, so remotes of equal rank keep git's order.
  const rank = (remote: Remote): number =>
    upstream?.startsWith(`${remote.name}/`) ? 0 : remote.name === "origin" ? 1 : 2;
  const page = [...remotes]
    .sort((a, b) => rank(a) - rank(b))
    .map((remote) => githubRepoPage(remote.url))
    .find((candidate) => candidate !== undefined);
  return page && `${page}/commit/${hash}`;
}

/**
 * The folder name `git clone` gives a clone of `url`: its last path part
 * without ".git", e.g. "repo" for "git@github.com:o/repo.git".
 */
export function cloneFolderName(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, "").split(/[\\/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

/** The folder a path is in: "D:\\code\\app" -> "D:\\code". Empty for a path with no folder. */
export function parentFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : "";
}
