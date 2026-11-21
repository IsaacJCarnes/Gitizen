import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import DiffView from "./DiffView";

export default function FileDiff(): React.JSX.Element {
  const { setView } = useAppContext();
  const { selectedCommit, selectedCommitFile, commitDiff, selectedFile, diff } =
    useGitOperationsContext();

  const path = selectedCommit ? selectedCommitFile?.path : selectedFile?.path;
  const source = selectedCommit
    ? selectedCommit.hash.slice(0, 7)
    : selectedFile?.staged
      ? "Staged"
      : "Unstaged";

  return (
    <div className="file-diff">
      <header className="diff-header">
        <button onClick={() => setView("history")}>← History</button>
        <span className="path" title={path}>
          {path}
        </span>
        <small>{source}</small>
      </header>
      {path ? (
        <DiffView diff={selectedCommit ? commitDiff : diff} />
      ) : (
        <p className="placeholder">Select a file in the sidebar.</p>
      )}
    </div>
  );
}
