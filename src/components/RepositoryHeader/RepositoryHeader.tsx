import "./RepositoryHeader.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import RepoSwitcher from "./RepoSwitcher";

/**
 * Top bar: repository switcher (recent repositories and "Add new repo"), branch switcher,
 * ahead/behind counts and a refresh button.
 */
export default function RepositoryHeader(): React.JSX.Element {
  const { status, branches, refresh, checkoutBranch } = useGitOperationsContext();
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
        {unbornBranch && <option key={unbornBranch}>{unbornBranch}</option>}
        {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
      </select>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="sync">{status.ahead} ahead, {status.behind} behind</span>
      )}
      <button onClick={refresh}>Refresh</button>
    </header>
  );
}
