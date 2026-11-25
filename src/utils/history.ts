/** Helpers for the history: range selections and the commit menu's actions (reset, squash). */
import type { GitCommit, ResetMode } from "../../shared/gitTypes";

/** What each reset mode keeps, for its menu item and confirmation. */
export const RESET_MODES: Record<ResetMode, { label: string; keeps: string }> = {
  soft: { label: "Soft", keeps: "their changes stay staged" },
  mixed: { label: "Mixed", keeps: "their changes stay in the working tree, unstaged" },
  hard: { label: "Hard", keeps: "their changes, and any uncommitted changes, are thrown away" },
};

/**
 * The commits from HEAD back along first parents to (not including)
 * `target`, newest first, or null if `target` isn't on that line.
 */
export function commitsAfter(commits: GitCommit[], target: string): GitCommit[] | null {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const head = commits.find((commit) => commit.refs.some((ref) => ref.current));
  const after: GitCommit[] = [];
  for (let commit = head; commit; commit = byHash.get(commit.parents[0])) {
    if (commit.hash === target) return after;
    after.push(commit);
  }
  return null;
}

/**
 * Why the selected commits (`selected`) can't be squashed, or undefined if
 * they can: they must be next to each other among `rewritable`, the
 * current branch's own commits.
 */
export function squashProblem(selected: GitCommit[], rewritable: string[], branch: string | null): string | undefined {
  const positions = selected.map((each) => rewritable.indexOf(each.hash)).sort((a, b) => a - b);
  if (positions[0] === -1) {
    return `Only ${branch}'s own commits can be squashed: not merges, and not commits that are pushed or that another branch or tag also has`;
  }
  if (positions[positions.length - 1] - positions[0] + 1 !== positions.length) {
    return "Select commits that are next to each other";
  }
  return undefined;
}

/** Why the current branch can't be reset to a commit, given `commitsAfter` for it, or undefined if it can. */
export function resetProblem(after: GitCommit[] | null): string | undefined {
  if (after === null) return "Only commits on the current branch's line can be reset to";
  if (after.length === 0) return "The branch is already at this commit";
  return undefined;
}

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
