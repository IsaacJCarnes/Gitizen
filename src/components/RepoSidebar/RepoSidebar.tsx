import './RepoSidebar.css'
import { useGitOperationsContext } from '../../context/GitOperationsContext'
import CommitForm from './CommitForm'
import FileChangeList from './FileChangeList'
import HistoryList from './HistoryList'
import { useAppContext } from '../../context/AppContext'

export default function RepoSidebar(): React.JSX.Element {
  const {view, setView} = useAppContext();
  const { status } = useGitOperationsContext()
  const changeCount = status?.files.length ?? 0

  return (
    <aside className="change-sidebar">
      <div className="sidebar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={view === 'changes'}
          className={view === 'changes' ? 'on' : ''}
          onClick={() => setView('changes')}
        >
          Changes{changeCount > 0 && <span className="count">{changeCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={view === 'history'}
          className={view === 'history' ? 'on' : ''}
          onClick={() => setView('history')}
        >
          History
        </button>
      </div>
      {view === 'changes' ? (
        <>
          <FileChangeList staged={false} />
          <FileChangeList staged />
          <CommitForm />
        </>
      ) : (
        <HistoryList />
      )}
    </aside>
  )
}
