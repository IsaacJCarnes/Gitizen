import { contextBridge, ipcRenderer } from 'electron'

const call = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a)

const api = {
  openRepo: (): Promise<string | null> => call('repo:open'),
  status: () => call('git:status'),
  log: () => call('git:log'),
  branches: () => call('git:branches'),
  diff: (path: string, staged: boolean): Promise<string> => call('git:diff', path, staged),
  stage: (paths: string[]) => call('git:stage', paths),
  unstage: (paths: string[]) => call('git:unstage', paths),
  commit: (msg: string) => call('git:commit', msg),
  checkout: (branch: string) => call('git:checkout', branch)
}

contextBridge.exposeInMainWorld('gitizen', api)
