import "./RepoSidebar.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { FINISHES_WITHOUT_COMMIT } from "../../utils/conflictText";
import StashConflictModal from "../Stash/StashConflictModal";
import StashFinish from "../Stash/StashFinish";
import StashActions from "../Stash/StashActions";
import StashFileList from "../Stash/StashFileList";
import CommitFileList from "./CommitFileList";
import CommitForm from "./CommitForm";
import FileChangeList from "./FileChangeList";

/**
 * Left sidebar. Shows the files of whatever is selected in the history: the
 * working tree (changed files with stage checkboxes, commit form) for
 * "Uncommitted changes", the stash's files with Pop and Discard when the
 * stash is selected, otherwise the selected commit's files. While a stash
 * conflict is being resolved, a button to finish it takes the commit
 * form's place.
 */
export default function RepoSidebar(): React.JSX.Element {
  const { selectedCommit, conflicts, stashSelected, branchStash } = useGitOperationsContext();
  const stashing = conflicts.operation !== null && FINISHES_WITHOUT_COMMIT.has(conflicts.operation);

  return (
    <aside className="repo-sidebar">
      {selectedCommit ? (
        <CommitFileList />
      ) : stashSelected && branchStash ? (
        <>
          <StashFileList />
          <StashActions />
        </>
      ) : (
        <>
          <FileChangeList />
          {stashing ? <StashFinish /> : <CommitForm />}
        </>
      )}
      <StashConflictModal />
    </aside>
  );
}
