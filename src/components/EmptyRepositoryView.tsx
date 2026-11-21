import './EmptyRepositoryView.css'
import { useGitOperationsContext } from '../context/ContextProvider'

export default function EmptyRepositoryView(): React.JSX.Element {
  const { error, openRepository } = useGitOperationsContext()

  return (
    <div className="empty">
      <h1>Gitizen</h1>
      <p>Open a folder that contains a git repository to see its changes and history.</p>
      <button className="primary" onClick={openRepository}>Open repository</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
