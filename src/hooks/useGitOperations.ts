import { useCallback, useEffect, useState } from 'react'
import type { CommitFile, FileChange, GitBranch, GitCommit, GitStatus } from '../types/git'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface GitOperations {
  repo: string | null
  status: GitStatus | null
  commits: GitCommit[]
  branches: GitBranch[]
  selectedFile: FileChange | null
  diff: string
  commitMessage: string
  error: string
  selectedCommit: GitCommit | null
  commitFiles: CommitFile[]
  selectedCommitFile: CommitFile | null
  commitDiff: string
  selectCommit: (commit: GitCommit | null) => void
  setSelectedCommitFile: (file: CommitFile | null) => void
  setSelectedFile: (file: FileChange | null) => void
  setCommitMessage: (message: string) => void
  openRepository: () => Promise<void>
  refresh: () => Promise<void>
  toggleFileStage: (file: FileChange) => Promise<void>
  commitChanges: () => Promise<void>
  checkoutBranch: (branch: string) => Promise<void>
}

export function useGitOperations(): GitOperations {
  const [repo, setRepo] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null)
  const [diff, setDiff] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [error, setError] = useState('')
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null)
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([])
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null)
  const [commitDiff, setCommitDiff] = useState('')

  // Clear the old commit's files and diff together so a stale file is never
  // diffed against the newly selected commit.
  const selectCommit = useCallback((commit: GitCommit | null): void => {
    setSelectedCommit(commit)
    setCommitFiles([])
    setSelectedCommitFile(null)
    setCommitDiff('')
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches] = await Promise.all([
        window.gitizen.status(),
        window.gitizen.log(),
        window.gitizen.branches()
      ])
      setStatus(nextStatus)
      setCommits(nextCommits)
      setBranches(nextBranches)
      setError('')
    } catch (refreshError) {
      setError(getErrorMessage(refreshError))
    }
  }, [])

  const runOperation = useCallback(async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation()
      await refresh()
    } catch (operationError) {
      setError(getErrorMessage(operationError))
    }
  }, [refresh])

  const openRepository = useCallback(async (): Promise<void> => {
    try {
      const directory = await window.gitizen.openRepo()
      if (!directory) return

      setRepo(directory)
      setSelectedFile(null)
      setDiff('')
      selectCommit(null)
      await refresh()
    } catch (openError) {
      setError(getErrorMessage(openError))
    }
  }, [refresh, selectCommit])

  const toggleFileStage = useCallback((file: FileChange): Promise<void> =>
    runOperation(() => file.staged
      ? window.gitizen.unstage([file.path])
      : window.gitizen.stage([file.path])), [runOperation])

  const commitChanges = useCallback(async (): Promise<void> => {
    const message = commitMessage.trim()
    if (!message) return

    await runOperation(async () => {
      await window.gitizen.commit(message)
      setCommitMessage('')
    })
  }, [commitMessage, runOperation])

  const checkoutBranch = useCallback((branch: string): Promise<void> =>
    runOperation(() => window.gitizen.checkout(branch)), [runOperation])

  useEffect(() => {
    if (!selectedFile) {
      setDiff('')
      return
    }

    let active = true
    window.gitizen.diff(selectedFile.path, selectedFile.staged).then((nextDiff) => {
      if (active) setDiff(nextDiff)
    }).catch((diffError: unknown) => {
      if (!active) return
      setDiff('')
      setError(getErrorMessage(diffError))
    })

    return () => {
      active = false
    }
  }, [selectedFile, status])

  // Staging or unstaging moves a file between lists; keep it selected
  // in its new list, and drop the selection once the file has no changes.
  useEffect(() => {
    setSelectedFile((current) => {
      if (!current || !status) return current
      const files = status.files.filter((file) => file.path === current.path)
      return files.find((file) => file.staged === current.staged) ?? files[0] ?? null
    })
  }, [status])

  useEffect(() => {
    if (!selectedCommit) return

    let active = true
    window.gitizen.commitFiles(selectedCommit.hash).then((files) => {
      if (!active) return
      setCommitFiles(files)
    }).catch((filesError: unknown) => {
      if (active) setError(getErrorMessage(filesError))
    })

    return () => {
      active = false
    }
  }, [selectedCommit])

  useEffect(() => {
    if (!selectedCommit || !selectedCommitFile) {
      setCommitDiff('')
      return
    }

    let active = true
    window.gitizen.commitDiff(
      selectedCommit.hash,
      selectedCommitFile.path,
      selectedCommitFile.oldPath
    ).then((nextDiff) => {
      if (active) setCommitDiff(nextDiff)
    }).catch((diffError: unknown) => {
      if (!active) return
      setCommitDiff('')
      setError(getErrorMessage(diffError))
    })

    return () => {
      active = false
    }
  }, [selectedCommit, selectedCommitFile])

  return {
    repo,
    status,
    commits,
    branches,
    selectedFile,
    diff,
    commitMessage,
    error,
    selectedCommit,
    commitFiles,
    selectedCommitFile,
    commitDiff,
    selectCommit,
    setSelectedCommitFile,
    setSelectedFile,
    setCommitMessage,
    openRepository,
    refresh,
    toggleFileStage,
    commitChanges,
    checkoutBranch
  }
}
