import "./Stash.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import FileListItem from "../common/FileListItem";

/**
 * Sidebar content while a stash is selected in the history: its message,
 * its branch and the files it changes. Clicking a file shows what the
 * stash changes in it.
 */
export default function StashFileList(): React.JSX.Element | null {
  const { selectedStash, selectedStashFile, selectStashFile } = useGitOperationsContext();
  const { view, setView } = useAppContext();
  if (!selectedStash) return null;

  return (
    <>
      <div className="commit-summary">
        <b>{selectedStash.message}</b>
        <small>Stash on {selectedStash.branch}</small>
      </div>
      <h2>Stashed files ({selectedStash.files.length})</h2>
      <ul className="file-change-list">
        {selectedStash.files.map((file) => (
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
