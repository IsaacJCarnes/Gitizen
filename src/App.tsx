import { useCallback, useEffect, useState } from 'react'
import './App.css'

type FileChange = { path: string; staged: boolean; code: string }
type Status = { branch: string | null; ahead: number; behind: number; files: FileChange[] }
type Commit = { hash: string; message: string; author: string; date: string }
type Branch = { name: string; current: boolean }

export default function App(): React.JSX.Element {
  const [repo, setRepo] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [log, setLog] = useState<Commit[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [selected, setSelected] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [s, l, b] = await Promise.all([
        window.gitizen.status(),
        window.gitizen.log(),
        window.gitizen.branches()
      ])
      setStatus(s); setLog(l); setBranches(b); setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); await refresh() } catch (e) { setError((e as Error).message) }
  }

  const open = async (): Promise<void> => {
    try {
      const dir = await window.gitizen.openRepo()
      if (dir) { setRepo(dir); setSelected(null); setDiff(''); await refresh() }
    } catch (e) { setError((e as Error).message) }
  }

  useEffect(() => {
    if (!selected) return setDiff('')
    window.gitizen.diff(selected.path, selected.staged).then(setDiff).catch(() => setDiff(''))
  }, [selected, status])

  if (!repo) {
    return (
      <div className="empty">
        <h1>Gitizen</h1>
        <p>Open a folder that contains a git repository to see its changes and history.</p>
        <button className="primary" onClick={open}>Open repository</button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  const staged = status?.files.filter((f) => f.staged) ?? []
  const unstaged = status?.files.filter((f) => !f.staged) ?? []

  const FileRow = ({ f }: { f: FileChange }): React.JSX.Element => (
    <li className={selected?.path === f.path && selected.staged === f.staged ? 'on' : ''}>
      <button className="name" onClick={() => setSelected(f)}>
        <span className={`code c-${f.code}`}>{f.code}</span>{f.path}
      </button>
      <button className="mini" onClick={() => run(() => f.staged ? window.gitizen.unstage([f.path]) : window.gitizen.stage([f.path]))}>
        {f.staged ? 'Unstage' : 'Stage'}
      </button>
    </li>
  )

  return (
    <div className="app">
      <header>
        <button onClick={open}>{repo.split(/[\\/]/).pop()}</button>
        <select value={status?.branch ?? ''} onChange={(e) => run(() => window.gitizen.checkout(e.target.value))}>
          {branches.map((b) => <option key={b.name}>{b.name}</option>)}
        </select>
        {status && (status.ahead > 0 || status.behind > 0) && (
          <span className="sync">{status.ahead} ahead, {status.behind} behind</span>
        )}
        <button onClick={refresh}>Refresh</button>
      </header>
      {error && <div className="error bar">{error}</div>}
      <main>
        <aside>
          <h2>Unstaged ({unstaged.length})</h2>
          <ul>{unstaged.map((f) => <FileRow key={'u' + f.path} f={f} />)}</ul>
          <h2>Staged ({staged.length})</h2>
          <ul>{staged.map((f) => <FileRow key={'s' + f.path} f={f} />)}</ul>
          <div className="commit">
            <textarea placeholder="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="primary" disabled={!msg.trim() || staged.length === 0}
              onClick={() => run(async () => { await window.gitizen.commit(msg.trim()); setMsg('') })}>
              Commit {staged.length} file{staged.length === 1 ? '' : 's'}
            </button>
          </div>
        </aside>
        <section className="center">
          {selected ? <pre className="diff">{diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>
          ))}</pre> : (
            <ol className="log">
              {log.map((c) => (
                <li key={c.hash}>
                  <b>{c.message}</b>
                  <small>{c.hash.slice(0, 7)} by {c.author} on {new Date(c.date).toLocaleDateString()}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  )
}
