import './DiffHistoryPanel.css'
import { useGitOperationsContext } from '../context/ContextProvider'

export default function DiffHistoryPanel(): React.JSX.Element {
  const { selectedFile, diff, commits } = useGitOperationsContext()

  return (
    <section className="center">
      {selectedFile ? (
        <pre className="diff">
          {diff.split('\n').map((line, index) => (
            <div
              key={index}
              className={
                line.startsWith('+') ? 'add' :
                  line.startsWith('-') ? 'del' :
                    line.startsWith('@@') ? 'hunk' : ''
              }
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      ) : (
        <ol className="log">
          {commits.map((commit) => (
            <li key={commit.hash}>
              <b>{commit.message}</b>
              <small>
                {commit.hash.slice(0, 7)} by {commit.author} on{' '}
                {new Date(commit.date).toLocaleDateString()}
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
