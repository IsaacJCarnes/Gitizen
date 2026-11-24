import "./RepositoryHeader.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import AccountButton from "../GitHub/AccountButton";
import BranchSwitcher from "./BranchSwitcher";
import RepoSwitcher from "./RepoSwitcher";
import SyncControls from "./SyncControls";

/**
 * Top bar: repository switcher (recent repositories and "Add new repo"),
 * branch switcher (with a search box and each branch's right-click menu),
 * a button back to unfinished conflicts, publish / fetch / pull / push
 * buttons and the GitHub account. There is no refresh button: the view
 * refreshes by itself when the repository changes (see `watchRepository`).
 */
export default function RepositoryHeader(): React.JSX.Element {
  const {
    conflicts,
    selectedCommit,
    selectCommit,
    setSelectedConflict,
  } = useGitOperationsContext();
  const { setView } = useAppContext();
  // The conflicted files are listed with the working tree's changes; while
  // a commit is selected instead, this button leads back to them.
  const conflictsHidden = conflicts.operation !== null && selectedCommit !== null;

  const showConflicts = (): void => {
    selectCommit(null);
    const first = conflicts.files[0]?.path;
    if (first) {
      setSelectedConflict(first);
      setView("conflict");
    }
  };

  return (
    <header className="repository-header">
      <RepoSwitcher />
      <BranchSwitcher />
      {conflictsHidden && (
        <button className="conflict-button" onClick={showConflicts}>
          {conflicts.files.length > 0
            ? `Resolve conflicts (${conflicts.files.length})`
            : "Finish resolving conflicts"}
        </button>
      )}
      <SyncControls />
      <AccountButton />
    </header>
  );
}
