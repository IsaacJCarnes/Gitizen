import { useCallback, useEffect, useState } from "react";
import type {
  CommitFile,
  FileChange,
  GitBranch,
  GitCommit,
  GitStatus,
} from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { getErrorMessage } from "../utils/format";

/** Everything the UI reads about the open repository, plus the actions it can take. */
export interface GitOperations {
  /** Path of the open repository, or null before one is opened. */
  repo: string | null;
  status: GitStatus | null;
  commits: GitCommit[];
  branches: GitBranch[];
  /** Working-tree file chosen in the sidebar, and its diff. */
  selectedFile: FileChange | null;
  diff: string;
  commitMessage: string;
  /** Last error from any git operation; cleared by the next successful refresh. */
  error: string;
  /** Commit chosen in the history; null means "Uncommitted changes". */
  selectedCommit: GitCommit | null;
  commitFiles: CommitFile[];
  /** File chosen within the selected commit, and its diff. */
  selectedCommitFile: CommitFile | null;
  commitDiff: string;
  selectCommit: (commit: GitCommit | null) => void;
  setSelectedCommitFile: (file: CommitFile | null) => void;
  setSelectedFile: (file: FileChange | null) => void;
  setCommitMessage: (message: string) => void;
  openRepository: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleFileStage: (file: FileChange) => Promise<void>;
  commitChanges: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
}

/**
 * Runs `request` and passes its result to `onResult` (or its error to
 * `onError`) unless the returned cleanup ran first. Use as an effect's body
 * so a slow response for an old selection can't overwrite a newer one.
 */
function loadUnlessCancelled<T>(
  request: Promise<T>,
  onResult: (value: T) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  request
    .then((value) => {
      if (active) onResult(value);
    })
    .catch((error: unknown) => {
      if (active) onError(error);
    });
  return () => {
    active = false;
  };
}

/**
 * Owns all git state for the app: the open repository, its status, history
 * and branches, the current selections and their diffs. Actions refresh the
 * state after they run and surface failures through `error`.
 *
 * Use it once (in AppProvider) and read it through `useGitOperationsContext`.
 */
export function useGitOperations(): GitOperations {
  const [repo, setRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [commitDiff, setCommitDiff] = useState("");

  const reportError = useCallback((caught: unknown): void => {
    setError(getErrorMessage(caught));
  }, []);

  // ---- Actions -------------------------------------------------------------

  // Clear the old commit's files and diff together so a stale file is never
  // diffed against the newly selected commit.
  const selectCommit = useCallback((commit: GitCommit | null): void => {
    setSelectedCommit(commit);
    setCommitFiles([]);
    setSelectedCommitFile(null);
    setCommitDiff("");
  }, []);

  /** Reloads status, history and branches together. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches] = await Promise.all([
        gitizen.status(),
        gitizen.log(),
        gitizen.branches(),
      ]);
      setStatus(nextStatus);
      setCommits(nextCommits);
      setBranches(nextBranches);
      setError("");
    } catch (refreshError) {
      reportError(refreshError);
    }
  }, [reportError]);

  /** Runs a git command, then refreshes; any failure is shown as the error. */
  const runOperation = useCallback(
    async (operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
        await refresh();
      } catch (operationError) {
        reportError(operationError);
      }
    },
    [refresh, reportError],
  );

  const openRepository = useCallback(async (): Promise<void> => {
    try {
      const directory = await gitizen.openRepo();
      if (!directory) return;

      setRepo(directory);
      setSelectedFile(null);
      setDiff("");
      selectCommit(null);
      await refresh();
    } catch (openError) {
      reportError(openError);
    }
  }, [refresh, reportError, selectCommit]);

  const toggleFileStage = useCallback(
    (file: FileChange): Promise<void> =>
      runOperation(() =>
        file.staged
          ? gitizen.unstage([file.path])
          : gitizen.stage([file.path]),
      ),
    [runOperation],
  );

  const commitChanges = useCallback(async (): Promise<void> => {
    const message = commitMessage.trim();
    if (!message) return;

    await runOperation(async () => {
      await gitizen.commit(message);
      setCommitMessage("");
    });
  }, [commitMessage, runOperation]);

  const checkoutBranch = useCallback(
    (branch: string): Promise<void> =>
      runOperation(() => gitizen.checkout(branch)),
    [runOperation],
  );

  // ---- Derived data loading ------------------------------------------------

  // Diff of the selected working-tree file; reloaded after every refresh
  // because staging or editing changes it.
  useEffect(() => {
    if (!selectedFile) {
      setDiff("");
      return;
    }
    return loadUnlessCancelled(
      gitizen.diff(selectedFile.path, selectedFile.staged),
      setDiff,
      (diffError) => {
        setDiff("");
        reportError(diffError);
      },
    );
  }, [selectedFile, status, reportError]);

  // Staging or unstaging moves a file between lists; keep it selected
  // in its new list, and drop the selection once the file has no changes.
  useEffect(() => {
    setSelectedFile((current) => {
      if (!current || !status) return current;
      const files = status.files.filter((file) => file.path === current.path);
      return files.find((file) => file.staged === current.staged) ?? files[0] ?? null;
    });
  }, [status]);

  // Files changed by the selected commit.
  useEffect(() => {
    if (!selectedCommit) return;
    return loadUnlessCancelled(
      gitizen.commitFiles(selectedCommit.hash),
      setCommitFiles,
      reportError,
    );
  }, [selectedCommit, reportError]);

  // Diff of the file chosen within the selected commit.
  useEffect(() => {
    if (!selectedCommit || !selectedCommitFile) {
      setCommitDiff("");
      return;
    }
    return loadUnlessCancelled(
      gitizen.commitDiff(
        selectedCommit.hash,
        selectedCommitFile.path,
        selectedCommitFile.oldPath,
      ),
      setCommitDiff,
      (diffError) => {
        setCommitDiff("");
        reportError(diffError);
      },
    );
  }, [selectedCommit, selectedCommitFile, reportError]);

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
    checkoutBranch,
  };
}
