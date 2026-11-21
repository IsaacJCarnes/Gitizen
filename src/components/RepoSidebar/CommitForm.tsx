import "./CommitForm.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";

/** Commit message box and button; commits whatever is currently staged. */
export default function CommitForm(): React.JSX.Element {
  const { status, commitMessage, setCommitMessage, commitChanges } =
    useGitOperationsContext();
  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;

  return (
    <div className="commit">
      <textarea
        placeholder="Commit message"
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
      />
      <button
        className="primary"
        disabled={!commitMessage.trim() || stagedCount === 0}
        onClick={commitChanges}
      >
        Commit {pluralize(stagedCount, "file")}
      </button>
    </div>
  );
}
