import { useCallback, useEffect, useState } from "react";
import type {
  CommitFile,
  FileChange,
  FileDiff,
  GitBranch,
  GitCommit,
  GitStatus,
  Remote,
} from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { toAppError, type AppError } from "../utils/errors";
import { useDiffSettings } from "./useDiffSettings";

/** A network operation the header's sync buttons can run. */
export type SyncAction = "fetch" | "pull" | "push";

/** Everything the UI reads about the open repository, plus the actions it can take. */
export interface GitOperations {
  /** Path of the open repository, or null before one is opened. */
  repo: string | null;
  status: GitStatus | null;
  commits: GitCommit[];
  branches: GitBranch[];
  /** Configured remotes; empty until the repository is published or a remote is added. */
  remotes: Remote[];
  /** The sync operation running now, or null. Only one runs at a time. */
  syncing: SyncAction | null;
  /** Fetches, pulls or pushes the current branch, then refreshes. */
  sync: (action: SyncAction) => Promise<void>;
  /** Adds a remote pointing at an existing repository. Resolves to true on success. */
  addRemote: (name: string, url: string) => Promise<boolean>;
  /** Creates the repository on GitHub with the GitHub CLI and pushes to it. Resolves to true on success. */
  publishRepository: (name: string, description: string, isPrivate: boolean) => Promise<boolean>;
  /** Working-tree file chosen in the sidebar, and its diff. */
  selectedFile: FileChange | null;
  diff: string;
  /** Indices into `diff.split("\n")` of the changed lines that are staged. */
  stagedLines: number[];
  /** One-line commit summary (the subject); required to commit. */
  commitSummary: string;
  /** Optional longer commit description (the body). */
  commitDescription: string;
  /** Last error from any git operation, shown in the error modal until dismissed. */
  error: AppError | null;
  /** Shows anything thrown in the error modal. */
  reportError: (caught: unknown) => void;
  /** Closes the error modal. */
  dismissError: () => void;
  /** Commit chosen in the history; null means "Uncommitted changes". */
  selectedCommit: GitCommit | null;
  commitFiles: CommitFile[];
  /** File chosen within the selected commit, and its diff. */
  selectedCommitFile: CommitFile | null;
  commitDiff: string;
  selectCommit: (commit: GitCommit | null) => void;
  setSelectedCommitFile: (file: CommitFile | null) => void;
  setSelectedFile: (file: FileChange | null) => void;
  setCommitSummary: (summary: string) => void;
  setCommitDescription: (description: string) => void;
  /** Shows the folder picker and opens the chosen repository. */
  openRepository: () => Promise<void>;
  /** Opens the repository at `path` (e.g. from the recent list) without a picker. */
  openRepositoryAt: (path: string) => Promise<void>;
  /** Runs `git init` in `path` (a folder that isn't a repository yet) and opens it. */
  initRepository: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Stages (`staged` true) or unstages every given path in one git call. */
  setFilesStaged: (paths: string[], staged: boolean) => Promise<void>;
  /** Commits the staged files with the summary, plus the description as the body if given. */
  commitChanges: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
  /** True while the AI command is writing a commit message. */
  generatingMessage: boolean;
  /**
   * Runs the saved AI command on the staged changes and fills the summary
   * and description with what it wrote. Failures show in the error modal.
   */
  generateCommitMessage: () => Promise<void>;
  /**
   * Stages (`staged` true) or unstages single lines of the selected file.
   * `lines` index `diff.split("\n")`. Does nothing while whitespace changes
   * are hidden, since that diff can't be applied.
   */
  stageLines: (lines: number[], staged: boolean) => Promise<void>;
}

export interface GitOperationsOptions {
  /** Called with the path each time a repository opens successfully. */
  onRepositoryOpened?: (path: string) => void;
}

const NO_DIFF: FileDiff = { diff: "", stagedLines: [] };

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
export function useGitOperations({
  onRepositoryOpened,
}: GitOperationsOptions = {}): GitOperations {
  const [repo, setRepo] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [syncing, setSyncing] = useState<SyncAction | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [{ diff, stagedLines }, setFileDiff] = useState(NO_DIFF);
  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [commitDiff, setCommitDiff] = useState("");
  const {
    settings: { hideWhitespace },
  } = useDiffSettings();

  const reportError = useCallback((caught: unknown): void => {
    setError(toAppError(caught));
  }, []);

  const dismissError = useCallback((): void => setError(null), []);

  // ---- Actions -------------------------------------------------------------

  // Clear the old commit's files and diff together so a stale file is never
  // diffed against the newly selected commit.
  const selectCommit = useCallback((commit: GitCommit | null): void => {
    setSelectedCommit(commit);
    setCommitFiles([]);
    setSelectedCommitFile(null);
    setCommitDiff("");
  }, []);

  /** Reloads status, history, branches and remotes together. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches, nextRemotes] = await Promise.all([
        gitizen.status(),
        gitizen.log(),
        gitizen.branches(),
        gitizen.remotes(),
      ]);
      setStatus(nextStatus);
      setCommits(nextCommits);
      setBranches(nextBranches);
      setRemotes(nextRemotes);
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

  /**
   * Shows `directory` (already opened by the backend), clears the previous
   * repository's selections and reports it as opened. The index is left as
   * it is, so the checkboxes show what is really staged.
   */
  const showRepository = useCallback(
    async (directory: string): Promise<void> => {
      setRepo(directory);
      setSelectedFile(null);
      setFileDiff(NO_DIFF);
      selectCommit(null);
      onRepositoryOpened?.(directory);
      await refresh();
    },
    [refresh, selectCommit, onRepositoryOpened],
  );

  /** Waits for the backend to open a repository (null: the picker was cancelled), then shows it. */
  const openWith = useCallback(
    async (opening: Promise<string | null>): Promise<void> => {
      try {
        const directory = await opening;
        if (directory) await showRepository(directory);
      } catch (openError) {
        reportError(openError);
      }
    },
    [showRepository, reportError],
  );

  const openRepository = useCallback(() => openWith(gitizen.openRepo()), [openWith]);
  const openRepositoryAt = useCallback(
    (path: string) => openWith(gitizen.openRepoAt(path)),
    [openWith],
  );
  const initRepository = useCallback(
    (path: string) => openWith(gitizen.initRepo(path)),
    [openWith],
  );

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
    const summary = commitSummary.trim();
    if (!summary) return;
    const description = commitDescription.trim();
    // Git convention: subject line, blank line, then the body.
    const message = description ? `${summary}\n\n${description}` : summary;

    await runOperation(async () => {
      await gitizen.commit(message);
      setCommitSummary("");
      setCommitDescription("");
    });
  }, [commitSummary, commitDescription, runOperation]);

  const generateCommitMessage = useCallback(async (): Promise<void> => {
    setGeneratingMessage(true);
    try {
      const { summary, description } = await gitizen.generateCommitMessage();
      setCommitSummary(summary);
      setCommitDescription(description);
    } catch (generateError) {
      reportError(generateError);
    } finally {
      setGeneratingMessage(false);
    }
  }, [reportError]);

  const checkoutBranch = useCallback(
    (branch: string): Promise<void> =>
      runOperation(() => gitizen.checkout(branch)),
    [runOperation],
  );

  const sync = useCallback(
    async (action: SyncAction): Promise<void> => {
      setSyncing(action);
      const run = { fetch: gitizen.fetch, pull: gitizen.pull, push: gitizen.push }[action];
      await runOperation(run);
      setSyncing(null);
    },
    [runOperation],
  );

  /** Runs `operation` and refreshes; resolves to false (with the error shown) if it failed. */
  const succeeds = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      let ok = false;
      await runOperation(async () => {
        await operation();
        ok = true;
      });
      return ok;
    },
    [runOperation],
  );

  const addRemote = useCallback(
    (name: string, url: string) => succeeds(() => gitizen.addRemote(name, url)),
    [succeeds],
  );

  const publishRepository = useCallback(
    async (name: string, description: string, isPrivate: boolean): Promise<boolean> => {
      // Publishing pushes, so the header shows it like a push meanwhile.
      setSyncing("push");
      const ok = await succeeds(() => gitizen.publishRepository(name, description, isPrivate));
      setSyncing(null);
      return ok;
    },
    [succeeds],
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
      setFileDiff(NO_DIFF);
      return;
    }
    return loadUnlessCancelled(
      gitizen.fileDiff(selectedFile.path, hideWhitespace),
      setFileDiff,
      (diffError) => {
        setFileDiff(NO_DIFF);
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
    remotes,
    syncing,
    sync,
    addRemote,
    publishRepository,
    selectedFile,
    diff,
    stagedLines,
    commitSummary,
    commitDescription,
    error,
    reportError,
    dismissError,
    selectedCommit,
    commitFiles,
    selectedCommitFile,
    commitDiff,
    selectCommit,
    setSelectedCommitFile,
    setSelectedFile,
    setCommitSummary,
    setCommitDescription,
    openRepository,
    openRepositoryAt,
    initRepository,
    refresh,
    setFilesStaged,
    commitChanges,
    checkoutBranch,
    generatingMessage,
    generateCommitMessage,
    stageLines,
  };
}
