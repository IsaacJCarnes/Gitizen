import './RepoSidebar.css'
import { useGitOperationsContext } from '../../context/GitOperationsContext'
import CommitFileList from './CommitFileList'
import CommitForm from './CommitForm'
import FileChangeList from './FileChangeList'

// Shows the files of whatever is selected in the history list:
// the working tree for "Uncommitted changes", otherwise that commit's files.
export default function RepoSidebar(): React.JSX.Element {
  const { selectedCommit } = useGitOperationsContext()

  return (
    <aside className="change-sidebar">
      {selectedCommit ? (
        <CommitFileList />
      ) : (
        <>
          <FileChangeList staged={false} />
          <FileChangeList staged />
          <CommitForm />
        </>
      )}
    </aside>
  )
}
