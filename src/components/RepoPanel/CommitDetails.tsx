import "./CommitDetails.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import DiffView from "./DiffView";

export default function CommitDetails(): React.JSX.Element {
  const {
    selectedCommit,
    commitFiles,
    selectedCommitFile,
    setSelectedCommitFile,
    commitDiff,
  } = useGitOperationsContext();

  if (!selectedCommit) {
    return <p className="placeholder">Select a commit to see its changes.</p>;
  }

  return (
    <div className="commit-details">
      <header>
        <b>{selectedCommit.message}</b>
        {selectedCommit.body && <p>{selectedCommit.body}</p>}
        <small>
          {selectedCommit.hash.slice(0, 7)} by {selectedCommit.author} on{" "}
          {new Date(selectedCommit.date).toLocaleString()}
        </small>
      </header>
      <div className="commit-body">
        <ul className="file-change-list">
          {commitFiles.map((file) => (
            <li
              key={file.path}
              className={selectedCommitFile?.path === file.path ? "on" : ""}
            >
              <button
                className="name"
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                onClick={() => setSelectedCommitFile(file)}
              >
                <span className={`code c-${file.code}`}>{file.code}</span>
                {file.path}
              </button>
            </li>
          ))}
        </ul>
        <div className="commit-diff">
          <DiffView diff={selectedCommitFile ? commitDiff : ""} />
        </div>
      </div>
    </div>
  );
}
