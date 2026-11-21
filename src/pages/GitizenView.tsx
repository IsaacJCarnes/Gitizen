import './GitizenView.css'
import { useGitOperationsContext } from '../context/ContextProvider'
import ChangeSidebar from '../components/Sidebar/ChangeSidebar'
import DiffHistoryPanel from '../components/DiffHistoryPanel'
import EmptyRepositoryView from '../components/EmptyRepositoryView'
import RepositoryHeader from '../components/RepositoryHeader'

export default function GitizenView(): React.JSX.Element {
  const { repo, error } = useGitOperationsContext()

  if (!repo) {
    return <EmptyRepositoryView />
  }

  return (
    <div className="gitizen-view">
      <RepositoryHeader />
      {error && <div className="error bar">{error}</div>}
      <main>
        <ChangeSidebar />
        <DiffHistoryPanel />
      </main>
    </div>
  )
}
