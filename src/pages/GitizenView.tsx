import './GitizenView.css'
import { useGitOperationsContext } from '../context/GitOperationsContext'
import RepoSidebar from '../components/RepoSidebar/RepoSidebar'
import RepoPanel from '../components/RepoPanel/RepoPanel'
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
        <RepoSidebar />
        <RepoPanel />
      </main>
    </div>
  )
}
