import './ChangeSidebar.css'
import CommitForm from './CommitForm'
import FileChangeList from './FileChangeList'

export default function ChangeSidebar(): React.JSX.Element {
  return (
    <aside className="change-sidebar">
      <FileChangeList staged={false} />
      <FileChangeList staged />
      <CommitForm />
    </aside>
  )
}
