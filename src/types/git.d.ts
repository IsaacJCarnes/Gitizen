export interface FileChange {
  path: string
  staged: boolean
  code: string
}

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: FileChange[]
}

export interface GitCommit {
  hash: string
  message: string
  body: string
  author: string
  date: string
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface CommitFile {
  path: string
  oldPath?: string
  code: string
}
