import type { FileChange } from "../../types/git";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";

interface FileChangeListProps {
  staged: boolean;
}

export default function FileChangeList({
  staged,
}: FileChangeListProps): React.JSX.Element {
  const { status, selectedFile, setSelectedFile, toggleFileStage } =
    useGitOperationsContext();
  const { setView } = useAppContext();
  const files: FileChange[] =
    status?.files.filter((file) => file.staged === staged) ?? [];

  return (
    <>
      <h2>
        {staged ? "Staged" : "Unstaged"} ({files.length})
      </h2>
      <ul className="file-change-list">
        {files.map((file) => (
          <li
            key={`${staged ? "s" : "u"}${file.path}`}
            className={
              selectedFile?.path === file.path &&
              selectedFile.staged === file.staged
                ? "on"
                : ""
            }
          >
            <button className="name" onClick={() => {
                setSelectedFile(file);
                setView("diff");
              }}>
              <span className={`code c-${file.code}`}>{file.code}</span>
              {file.path}
            </button>
            <button className="mini" onClick={() => toggleFileStage(file)}>
              {file.staged ? "Unstage" : "Stage"}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
