import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { commitsBetween } from "../../utils/commitRange";
import { pluralize, shortHash } from "../../utils/format";

/**
 * Header for several selected commits: how many, the range their changes
 * are shown for, and each one's subject.
 */
export default function SelectionSummary(): React.JSX.Element | null {
  const { commits, selectedCommits, selectedCommit, selectionBase } = useGitOperationsContext();
  if (!selectedCommit || !selectionBase) return null;

  // The changes shown run from the oldest through the newest selected
  // commit, so commits between them that aren't selected are included too
  // (on the line between them, when one descends from the other).
  const span = commitsBetween(commits, selectedCommit.hash, selectionBase.hash).length;
  const skipped = Math.max(0, span - selectedCommits.length);

  return (
    <div className="commit-summary">
      <b>{pluralize(selectedCommits.length, "commit")} selected</b>
      <small>
        Changes from {shortHash(selectionBase.hash)} through {shortHash(selectedCommit.hash)}, together
        {skipped > 0 && `, including ${pluralize(skipped, "unselected commit")} in between`}
      </small>
      <ul className="selection-list">
        {selectedCommits.map((commit) => (
          <li key={commit.hash} title={`${shortHash(commit.hash)} by ${commit.author}`}>
            <code>{shortHash(commit.hash)}</code> {commit.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
