/** Which commits lie between two commits of the history, for range selections. */
import type { GitCommit } from "../../shared/gitTypes";

/**
 * The commits between `a` and `b` (both included), in history order
 * (children before parents). When one descends from the other, that is
 * only the commits on the line between them, like `git log
 * --ancestry-path`: commits other branches made meanwhile are left out.
 * Otherwise it is every row between them in the history. Empty if either
 * isn't in `commits`.
 */
export function commitsBetween(commits: GitCommit[], a: string, b: string): GitCommit[] {
  const ia = commits.findIndex((commit) => commit.hash === a);
  const ib = commits.findIndex((commit) => commit.hash === b);
  if (ia === -1 || ib === -1) return [];
  const [newer, older] = ia <= ib ? [ia, ib] : [ib, ia];
  const rows = commits.slice(newer, older + 1);

  // Children come before parents, so walking the rows from the oldest up,
  // a commit is on the line when the older commit is it or one of its
  // parents already is; it then counts only if the newer commit reaches it.
  const descends = new Set<string>([commits[older].hash]);
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].parents.some((parent) => descends.has(parent))) descends.add(rows[i].hash);
  }
  if (!descends.has(commits[newer].hash)) return rows;
  const reached = new Set<string>([commits[newer].hash]);
  for (const commit of rows) {
    if (reached.has(commit.hash)) commit.parents.forEach((parent) => reached.add(parent));
  }
  return rows.filter((commit) => descends.has(commit.hash) && reached.has(commit.hash));
}
