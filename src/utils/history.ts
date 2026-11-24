/** Helpers for the history actions (reset, squash) in the commit menu. */
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
