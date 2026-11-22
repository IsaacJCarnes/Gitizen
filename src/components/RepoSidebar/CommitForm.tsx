import "./CommitForm.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";

/**
 * Commit summary (required, one line) and description (optional) with the
 * commit button; commits whatever is currently staged.
 */
export default function CommitForm(): React.JSX.Element {
  const {
    status,
    commitSummary,
    setCommitSummary,
    commitDescription,
    setCommitDescription,
    commitChanges,
  } = useGitOperationsContext();
  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;
  const canCommit = commitSummary.trim() !== "" && stagedCount > 0;

  // Ctrl+Enter (Cmd+Enter on macOS) in either field commits.
  const commitOnCtrlEnter = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && canCommit) {
      event.preventDefault();
      void commitChanges();
    }
  };

  return (
    <div className="commit">
      <input
        type="text"
        placeholder="Summary (required)"
        aria-label="Commit summary"
        value={commitSummary}
        onChange={(event) => setCommitSummary(event.target.value)}
        onKeyDown={commitOnCtrlEnter}
      />
      <textarea
        placeholder="Description"
        aria-label="Commit description"
        value={commitDescription}
        onChange={(event) => setCommitDescription(event.target.value)}
        onKeyDown={commitOnCtrlEnter}
      />
      <button className="primary" disabled={!canCommit} onClick={commitChanges}>
        Commit {pluralize(stagedCount, "file")}
      </button>
    </div>
  );
}
