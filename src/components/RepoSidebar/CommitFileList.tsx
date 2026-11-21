import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { CommitFile } from "../../types/git";

export default function CommitFileList(): React.JSX.Element | null {
  const { setView } = useAppContext();
  const {
    selectedCommit,
    commitFiles,
    selectedCommitFile,
    setSelectedCommitFile,
  } = useGitOperationsContext();

  if (!selectedCommit) return null;

  const open = (file: CommitFile): void => {
    setSelectedCommitFile(file);
    setView("diff");
  };

  return (
    <>
      <div className="commit-summary">
        <b>{selectedCommit.message}</b>
        {selectedCommit.body && <p>{selectedCommit.body}</p>}
        <small>
          {selectedCommit.hash.slice(0, 7)} by {selectedCommit.author} on{" "}
          {new Date(selectedCommit.date).toLocaleString()}
        </small>
      </div>
      <h2>Changed files ({commitFiles.length})</h2>
      <ul className="file-change-list">
        {commitFiles.map((file) => (
          <li
            key={file.path}
            className={selectedCommitFile?.path === file.path ? "on" : ""}
          >
            <button
              className="name"
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              onClick={() => open(file)}
            >
              <span className={`code c-${file.code}`}>{file.code}</span>
              {file.path}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
