import type { GitBranch, GitCommit, Remote } from "../../../shared/gitTypes";

/** The remote a new branch is published to: `origin`, else the only remote. */
export function pushRemote(remotes: Remote[]): string | null {
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  return remotes.length === 1 ? remotes[0].name : null;
}

/** The local main branch (`main`, else `master`), if there is one. */
export function trunkBranch(branches: GitBranch[]): string | null {
  for (const name of ["main", "master"]) {
    if (branches.some((branch) => branch.name === name)) return name;
  }
  return null;
}

/** True when `remote` has no branches yet (none show in the history). */
export function remoteIsEmpty(remote: string, commits: GitCommit[]): boolean {
  const prefix = `${remote}/`;
  return !commits.some((commit) =>
    commit.refs.some((ref) => ref.type === "remote" && ref.name.startsWith(prefix)),
  );
}

/**
 * The main branch to warn about when publishing `current` would make it
 * the remote's first (and so default) branch instead of main; null when
 * there is nothing to warn about.
 */
export function publishWarning(
  current: string | null | undefined,
  branches: GitBranch[],
  remote: string | null,
  commits: GitCommit[],
): string | null {
  const trunk = trunkBranch(branches);
  if (!current || !trunk || current === trunk) return null;
  if (remote !== null && !remoteIsEmpty(remote, commits)) return null;
  return trunk;
}
