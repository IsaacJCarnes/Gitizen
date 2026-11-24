import "./Stash.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import FileListItem from "../common/FileListItem";

/**
 * Sidebar content while the stash is selected in the history: its message
 * and the files it changes. Clicking a file shows what the stash changes
 * in it.
 */
export default function StashFileList(): React.JSX.Element | null {
  const { branchStash, status, selectedStashFile, selectStashFile } = useGitOperationsContext();
  const { view, setView } = useAppContext();
  if (!branchStash) return null;

  return (
    <>
      <div className="commit-summary">
        <b>{branchStash.message}</b>
        <small>Stash on {status?.branch ?? "this branch"}</small>
      </div>
      <h2>Stashed files ({branchStash.files.length})</h2>
      <ul className="file-change-list">
        {branchStash.files.map((file) => (
          <FileListItem
            key={file.path}
            path={file.path}
            code={file.code}
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            selected={view === "diff" && selectedStashFile?.path === file.path}
            onSelect={() => {
              selectStashFile(file);
              setView("diff");
            }}
          />
        ))}
      </ul>
    </>
  );
}
