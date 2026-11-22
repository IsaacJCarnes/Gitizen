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
  const tracked = upstream && remotes.find((remote) => upstream.startsWith(`${remote.name}/`));
  const ordered = [
    ...(tracked ? [tracked] : []),
    ...remotes.filter((remote) => remote.name === "origin"),
    ...remotes,
  ];
  for (const remote of ordered) {
    const page = githubRepoPage(remote.url);
    if (page) return `${page}/commit/${hash}`;
  }
  return undefined;
}
