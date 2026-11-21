import './RepositoryHeader.css'
import { useGitOperationsContext } from '../context/ContextProvider'

export default function RepositoryHeader(): React.JSX.Element {
  const { repo, status, branches, openRepository, refresh, checkoutBranch } =
    useGitOperationsContext()

  return (
    <header className="repository-header">
      <button onClick={openRepository}>{repo?.split(/[\\/]/).pop()}</button>
      <select
        value={status?.branch ?? ''}
        onChange={(event) => checkoutBranch(event.target.value)}
      >
        {branches.map((branch) => <option key={branch.name}>{branch.name}</option>)}
      </select>
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="sync">{status.ahead} ahead, {status.behind} behind</span>
      )}
      <button onClick={refresh}>Refresh</button>
    </header>
  )
}
