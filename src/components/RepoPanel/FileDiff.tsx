import "./FileDiff.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { shortHash } from "../../utils/format";
import DiffView from "../common/DiffView";

/**
 * Diff of the file picked in the sidebar, with a header naming the file and
 * where the change lives (a commit's short hash, or Staged/Unstaged) and a
 * button back to the history.
 */
export default function FileDiff(): React.JSX.Element {
  const { setView } = useAppContext();
  const { selectedCommit, selectedCommitFile, commitDiff, selectedFile, diff } =
    useGitOperationsContext();

  const path = selectedCommit ? selectedCommitFile?.path : selectedFile?.path;
  let source: string;
  if (selectedCommit) source = shortHash(selectedCommit.hash);
  else source = selectedFile?.staged ? "Staged" : "Unstaged";

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
