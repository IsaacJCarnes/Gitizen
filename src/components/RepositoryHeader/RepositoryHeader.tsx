import "./RepositoryHeader.css";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import RepoSwitcher from "./RepoSwitcher";
import SyncControls from "./SyncControls";

/**
 * Top bar: repository switcher (recent repositories and "Add new repo"), branch switcher,
 * a button back to unfinished conflicts, publish / fetch / pull / push
 * buttons and a refresh button.
 */
export default function RepositoryHeader(): React.JSX.Element {
  const {
    status,
    branches,
    refresh,
    checkoutBranch,
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
  // A new repository's branch has no commits yet, so it isn't listed in
  // `branches`; show it anyway so the label isn't blank.
  const current = status?.branch;
  const unbornBranch =
    current && !branches.some((branch) => branch.name === current) ? current : null;

  return (
    <header className="repository-header">
      <RepoSwitcher />
      <select
        value={status?.branch ?? ""}
        onChange={(event) => checkoutBranch(event.target.value)}
      >
        {status && status.branch === null && <option value="">Detached HEAD</option>}
        {unbornBranch && <option key={unbornBranch}>{unbornBranch}</option>}
        {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
      </select>
      {conflictsHidden && (
        <button className="conflict-button" onClick={showConflicts}>
          {conflicts.files.length > 0
            ? `Resolve conflicts (${conflicts.files.length})`
            : "Finish resolving conflicts"}
        </button>
      )}
      <SyncControls />
      <button onClick={refresh}>Refresh</button>
    </header>
  );
}
