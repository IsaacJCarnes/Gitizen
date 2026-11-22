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
import { useDiffSettings } from "./useDiffSettings";

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
  /** Indices into `diff.split("\n")` of the changed lines that are staged. */
  stagedLines: number[];
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
  /** Stages (`staged` true) or unstages every given path in one git call. */
  setFilesStaged: (paths: string[], staged: boolean) => Promise<void>;
  commitChanges: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
  /**
   * Stages (`staged` true) or unstages single lines of the selected file.
   * `lines` index `diff.split("\n")`. Does nothing while whitespace changes
   * are hidden, since that diff can't be applied.
   */
  stageLines: (lines: number[], staged: boolean) => Promise<void>;
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
 * Stages every file with working-tree changes (untracked files included),
 * so a freshly loaded repository starts with every file ticked.
 */
async function stageAllChanges(): Promise<void> {
  const { files } = await gitizen.status();
  const paths = [...new Set(files.filter((file) => !file.staged).map((file) => file.path))];
  if (paths.length > 0) await gitizen.stage(paths);
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
  const [stagedLines, setStagedLines] = useState<number[]>([]);
  const [commitMessage, setCommitMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [commitDiff, setCommitDiff] = useState("");
  const {
    settings: { hideWhitespace },
  } = useDiffSettings();

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
      await stageAllChanges();
      await refresh();
    } catch (openError) {
      reportError(openError);
    }
  }, [refresh, reportError, selectCommit]);

  const setFilesStaged = useCallback(
    (paths: string[], staged: boolean): Promise<void> => {
      if (paths.length === 0) return Promise.resolve();
      return runOperation(() =>
        staged ? gitizen.stage(paths) : gitizen.unstage(paths),
      );
    },
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

  const stageLines = useCallback(
    (lines: number[], staged: boolean): Promise<void> => {
      if (!selectedFile || lines.length === 0 || hideWhitespace) {
        return Promise.resolve();
      }
      return runOperation(() =>
        gitizen.setStagedLines(selectedFile.path, diff, lines, staged),
      );
    },
    [selectedFile, diff, hideWhitespace, runOperation],
  );

  // ---- Derived data loading ------------------------------------------------

  // Diff of the selected working-tree file against HEAD, staged and unstaged
  // changes together, so staging doesn't change it (only which lines are
  // ticked). Reloaded after every refresh because editing the file does.
  useEffect(() => {
    if (!selectedFile) {
      setDiff("");
      setStagedLines([]);
      return;
    }
    return loadUnlessCancelled(
      gitizen.fileDiff(selectedFile.path, hideWhitespace),
      (result) => {
        setDiff(result.diff);
        setStagedLines(result.stagedLines);
      },
      (diffError) => {
        setDiff("");
        setStagedLines([]);
        reportError(diffError);
      },
    );
  }, [selectedFile, status, hideWhitespace, reportError]);

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
        hideWhitespace,
      ),
      setCommitDiff,
      (diffError) => {
        setCommitDiff("");
        reportError(diffError);
      },
    );
  }, [selectedCommit, selectedCommitFile, hideWhitespace, reportError]);

  return {
    repo,
    status,
    commits,
    branches,
    selectedFile,
    diff,
    stagedLines,
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
    setFilesStaged,
    commitChanges,
    checkoutBranch,
    stageLines,
  };
}
