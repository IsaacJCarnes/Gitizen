import "./RepositoryHeader.css";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import RepoSwitcher from "./RepoSwitcher";

/**
 * Top bar: repository switcher (recent repositories and "Add new repo"), branch switcher,
 * ahead/behind counts and a refresh button.
 */
export default function RepositoryHeader(): React.JSX.Element {
  const { status, branches, refresh, checkoutBranch } = useGitOperationsContext();

  return (
    <header className="repository-header">
      <RepoSwitcher />
      <select
        value={status?.branch ?? ""}
        onChange={(event) => checkoutBranch(event.target.value)}
      >
        {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
      </select>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="sync">{status.ahead} ahead, {status.behind} behind</span>
      )}
      <button onClick={refresh}>Refresh</button>
    </header>
  );
}
