import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { CommitFile } from "../../../shared/gitTypes";
import FileListItem from "../common/FileListItem";
import CommitSummary from "./CommitSummary";

/**
 * Sidebar content when a commit is selected in the history: the commit's
 * summary and the files it changed. Picking a file opens its diff.
 */
export default function CommitFileList(): React.JSX.Element | null {
  const { setView } = useAppContext();
  const { selectedCommit, commitFiles, selectedCommitFile, setSelectedCommitFile } =
    useGitOperationsContext();

  if (!selectedCommit) return null;

  const open = (file: CommitFile): void => {
    setSelectedCommitFile(file);
    setView("diff");
  };

  return (
    <>
      <CommitSummary commit={selectedCommit} />
      <h2>Changed files ({commitFiles.length})</h2>
      <ul className="file-change-list">
        {commitFiles.map((file) => (
          <FileListItem
            key={file.path}
            path={file.path}
            code={file.code}
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            selected={selectedCommitFile?.path === file.path}
            onSelect={() => open(file)}
          />
        ))}
      </ul>
    </>
  );
}
