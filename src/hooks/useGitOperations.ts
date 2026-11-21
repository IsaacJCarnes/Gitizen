import { useCallback, useEffect, useState } from 'react'
import type { FileChange, GitBranch, GitCommit, GitStatus } from '../types/gitTypes'

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
      await refresh()
    } catch (openError) {
      setError(getErrorMessage(openError))
    }
  }, [refresh])

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

  return {
    repo,
    status,
    commits,
    branches,
    selectedFile,
    diff,
    commitMessage,
    error,
    setSelectedFile,
    setCommitMessage,
    openRepository,
    refresh,
    toggleFileStage,
    commitChanges,
    checkoutBranch
  }
}
