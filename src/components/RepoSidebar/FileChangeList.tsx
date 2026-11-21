import type { FileChange } from "../../../shared/gitTypes";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import FileListItem from "../common/FileListItem";

interface FileChangeListProps {
  /** Show the staged files (true) or the unstaged ones (false). */
  staged: boolean;
}

/**
 * Working-tree files with uncommitted changes, either staged or unstaged.
 * Each row opens its diff and has a button to stage or unstage it.
 */
export default function FileChangeList({ staged }: FileChangeListProps): React.JSX.Element {
  const { status, selectedFile, setSelectedFile, toggleFileStage } =
    useGitOperationsContext();
  const { setView } = useAppContext();
  const files: FileChange[] =
    status?.files.filter((file) => file.staged === staged) ?? [];

  const open = (file: FileChange): void => {
    setSelectedFile(file);
    setView("diff");
  };

  return (
    <>
      <h2>
        {staged ? "Staged" : "Unstaged"} ({files.length})
      </h2>
      <ul className="file-change-list">
        {files.map((file) => (
          <FileListItem
            key={`${staged ? "s" : "u"}${file.path}`}
            path={file.path}
            code={file.code}
            selected={
              selectedFile?.path === file.path && selectedFile.staged === file.staged
            }
            onSelect={() => open(file)}
            action={
              <button className="mini" onClick={() => toggleFileStage(file)}>
                {file.staged ? "Unstage" : "Stage"}
              </button>
            }
          />
        ))}
      </ul>
    </>
  );
}
