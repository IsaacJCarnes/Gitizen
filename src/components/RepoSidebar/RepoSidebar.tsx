import "./RepoSidebar.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import CommitFileList from "./CommitFileList";
import CommitForm from "./CommitForm";
import FileChangeList from "./FileChangeList";

/**
 * Left sidebar. Shows the files of whatever is selected in the history: the
 * working tree (changed files with stage checkboxes, commit form) for
 * "Uncommitted changes", otherwise the selected commit's files.
 */
export default function RepoSidebar(): React.JSX.Element {
  const { selectedCommit } = useGitOperationsContext();

  return (
    <aside className="repo-sidebar">
      {selectedCommit ? (
        <CommitFileList />
      ) : (
        <>
          <FileChangeList />
          <CommitForm />
        </>
      )}
    </aside>
  );
}
