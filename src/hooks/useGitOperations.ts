import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommitFile,
  ConflictState,
  FileChange,
  FileDiff,
  GitBranch,
  GitCommit,
  GitStatus,
  Remote,
  Resolution,
} from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { toAppError, type AppError } from "../utils/errors";
import { useDiffSettings } from "./useDiffSettings";

/** A network operation the header's sync buttons can run. */
export type SyncAction = "fetch" | "pull" | "push";

/**
 * Everything the UI reads about the open repository, plus the actions it can
 * take. Actions that run git resolve to true when they worked; on failure
 * they show the error modal and resolve to false (they never reject).
 */
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
  sync: (action: SyncAction) => Promise<boolean>;
  /**
   * True after amending or undoing a commit that was already pushed: the
   * branch no longer matches the remote, so Push becomes a force push.
   */
  needsForcePush: boolean;
  /** Adds a remote pointing at an existing repository. */
  addRemote: (name: string, url: string) => Promise<boolean>;
  /** Creates the repository on GitHub with the GitHub CLI and pushes to it. */
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
  setFilesStaged: (paths: string[], staged: boolean) => Promise<boolean>;
  /**
   * Commits the staged files with the summary, plus the description as the
   * body if given. While `amending`, replaces the last commit instead.
   */
  commitChanges: () => Promise<boolean>;
  /** True while the commit form amends the last commit instead of making a new one. */
  amending: boolean;
  /**
   * Puts the commit form in amend mode, filled with `commit`'s message, and
   * shows the working tree so more changes can be staged. `commit` is the
   * tip of the current branch, or of `branch`, which is checked out first.
   */
  startAmend: (commit: GitCommit, branch?: string) => Promise<void>;
  /** Leaves amend mode and clears the message it filled in. */
  cancelAmend: () => void;
  /** Call before amending or undoing a pushed commit, so the next push forces. */
  markPushedCommitRewritten: () => void;
  /**
   * Undoes `commit`, keeping its changes staged, and puts its message back
   * in the commit form (unless the form already has a summary). `commit` is
   * the tip of the current branch, or of `branch`, which is checked out first.
   */
  undoLastCommit: (commit: GitCommit, branch?: string) => Promise<void>;
  /** Stashes all uncommitted changes. */
  stashChanges: (message: string) => Promise<boolean>;
  checkoutBranch: (branch: string) => Promise<boolean>;
  /** Checks out a commit itself (detached HEAD). */
  checkoutCommit: (hash: string) => Promise<boolean>;
  /** Creates a branch at `hash`, switching to it when `checkout`. */
  createBranch: (name: string, hash: string, checkout: boolean) => Promise<boolean>;
  /** Tags `hash`. */
  createTag: (name: string, hash: string, message: string) => Promise<boolean>;
  /** Cherry-picks `hash` onto `branch` (switching to it). */
  cherryPick: (hash: string, branch: string) => Promise<boolean>;
  /** The stopped merge, cherry-pick, rebase or revert, and its unresolved files. */
  conflicts: ConflictState;
  /**
   * Conflicted file open in the conflict editor, or null. Set to the first
   * conflicted file by itself when an operation stops on conflicts.
   */
  selectedConflict: string | null;
  setSelectedConflict: (path: string | null) => void;
  /** Takes one side for a conflicted file, or keeps it as saved ("asIs"), and stages it. */
  resolveConflict: (path: string, resolution: Resolution) => Promise<boolean>;
  /** Writes the conflict editor's output to the file (unstaged). */
  saveConflictResolution: (path: string, text: string) => Promise<boolean>;
  /** Opens the file in the external tool, refreshing after a merge tool closes. */
  openInMergeTool: (path: string) => Promise<boolean>;
  continueOperation: () => Promise<boolean>;
  abortOperation: () => Promise<boolean>;
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
  stageLines: (lines: number[], staged: boolean) => Promise<boolean>;
}

export interface GitOperationsOptions {
  /** Called with the path each time a repository opens successfully. */
  onRepositoryOpened?: (path: string) => void;
}

const NO_DIFF: FileDiff = { diff: "", stagedLines: [] };
const NO_CONFLICTS: ConflictState = {
  operation: null,
  files: [],
  message: null,
  incoming: null,
  current: null,
};

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
  const [conflicts, setConflicts] = useState<ConflictState>(NO_CONFLICTS);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  // The operation seen by the last refresh, to notice one starting.
  const lastOperation = useRef<ConflictState["operation"]>(null);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [{ diff, stagedLines }, setFileDiff] = useState(NO_DIFF);
  const [commitSummary, setCommitSummary] = useState("");
  // The summary as typed, readable from `refresh` without re-creating it on
  // every keystroke.
  const summaryRef = useRef(commitSummary);
  summaryRef.current = commitSummary;
  const [commitDescription, setCommitDescription] = useState("");
  /** Fills both commit form fields at once; no arguments clears them. */
  const setMessage = useCallback((summary = "", description = ""): void => {
    setCommitSummary(summary);
    setCommitDescription(description);
  }, []);
  const [error, setError] = useState<AppError | null>(null);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [amending, setAmending] = useState(false);
  const [needsForcePush, setNeedsForcePush] = useState(false);
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

  /** Reloads status, history, branches, remotes and conflicts together. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches, nextRemotes, nextConflicts] =
        await Promise.all([
          gitizen.status(),
          gitizen.log(),
          gitizen.branches(),
          gitizen.remotes(),
          gitizen.conflicts(),
        ]);
      setStatus(nextStatus);
      setCommits(nextCommits);
      setBranches(nextBranches);
      setRemotes(nextRemotes);
      setConflicts(nextConflicts);
      // Open the first conflicted file when an operation has just stopped (or
      // is found stopped on opening a repository), and close it once finished.
      if (nextConflicts.operation !== lastOperation.current) {
        setSelectedConflict(nextConflicts.files[0]?.path ?? null);
        if (nextConflicts.operation) {
          // Show the working tree, where the conflicted files are listed.
          selectCommit(null);
          // Start the commit form with git's message for finishing it
          // ("Merge branch 'x'"), unless the user is already writing one.
          const prepared = nextConflicts.message;
          if (prepared && !summaryRef.current.trim()) {
            const [first, ...rest] = prepared.split("\n");
            setMessage(first, rest.join("\n").trim());
          }
        }
        lastOperation.current = nextConflicts.operation;
      }
    } catch (refreshError) {
      reportError(refreshError);
    }
  }, [reportError, selectCommit, setMessage]);

  /**
   * Runs a git command, then refreshes. Resolves to false (with the error
   * shown) if it failed, so callers can tell without a try/catch of their own.
   */
  const runOperation = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      try {
        await operation();
        await refresh();
        return true;
      } catch (operationError) {
        reportError(operationError);
        return false;
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
      lastOperation.current = null;
      setAmending(false);
      setNeedsForcePush(false);
      pendingForcePush.current = false;
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
    (paths: string[], staged: boolean): Promise<boolean> => {
      if (paths.length === 0) return Promise.resolve(true);
      return runOperation(() =>
        staged ? gitizen.stage(paths) : gitizen.unstage(paths),
      );
    },
    [runOperation],
  );

  const commitChanges = useCallback(async (): Promise<boolean> => {
    const summary = commitSummary.trim();
    if (!summary) return false;
    const description = commitDescription.trim();
    // Git convention: subject line, blank line, then the body.
    const message = description ? `${summary}\n\n${description}` : summary;

    return runOperation(async () => {
      await gitizen.commit(message, amending);
      // Committing finishes a merge, cherry-pick or revert by itself; a
      // rebase then moves on to its next commit.
      if (conflicts.operation === "rebase") await gitizen.continueOperation();
      if (amending && pendingForcePush.current) setNeedsForcePush(true);
      pendingForcePush.current = false;
      setMessage();
      setAmending(false);
    });
  }, [commitSummary, commitDescription, amending, conflicts.operation, runOperation, setMessage]);

  const startAmend = useCallback(
    async (commit: GitCommit, branch?: string): Promise<void> => {
      // Another branch's tip: switch to that branch first. If switching
      // fails (the error is shown), stay out of amend mode.
      if (branch && !(await runOperation(() => gitizen.checkout(branch)))) return;
      setMessage(commit.message, commit.body);
      setAmending(true);
      // Amending happens in the working tree's commit form.
      selectCommit(null);
    },
    [runOperation, selectCommit, setMessage],
  );

  // Set when amending a pushed commit; only takes effect once the amend is
  // actually committed (cancelling it leaves the branch as it was).
  const pendingForcePush = useRef(false);
  const markPushedCommitRewritten = useCallback((): void => {
    pendingForcePush.current = true;
  }, []);

  const cancelAmend = useCallback((): void => {
    pendingForcePush.current = false;
    setAmending(false);
    setMessage();
  }, [setMessage]);

  const undoLastCommit = useCallback(async (commit: GitCommit, branch?: string): Promise<void> => {
    await runOperation(async () => {
      // Another branch's tip: switch to that branch so it is the last commit.
      if (branch) await gitizen.checkout(branch);
      await gitizen.undoLastCommit();
      if (pendingForcePush.current) setNeedsForcePush(true);
      pendingForcePush.current = false;
      setAmending(false);
      // Don't overwrite a message the user is already writing.
      if (!commitSummary.trim()) setMessage(commit.message, commit.body);
      selectCommit(null);
    });
  }, [commitSummary, runOperation, selectCommit, setMessage]);

  const generateCommitMessage = useCallback(async (): Promise<void> => {
    setGeneratingMessage(true);
    try {
      const { summary, description } = await gitizen.generateCommitMessage();
      setMessage(summary, description);
    } catch (generateError) {
      reportError(generateError);
    } finally {
      setGeneratingMessage(false);
    }
  }, [reportError, setMessage]);

  const checkoutBranch = useCallback(
    (branch: string) => runOperation(() => gitizen.checkout(branch)),
    [runOperation],
  );

  const checkoutCommit = useCallback(
    (hash: string) => runOperation(() => gitizen.checkoutCommit(hash)),
    [runOperation],
  );

  const sync = useCallback(
    async (action: SyncAction): Promise<boolean> => {
      setSyncing(action);
      const run = {
        fetch: gitizen.fetch,
        pull: gitizen.pull,
        push: async () => {
          await gitizen.push(needsForcePush);
          setNeedsForcePush(false);
        },
      }[action];
      const ok = await runOperation(run);
      setSyncing(null);
      return ok;
    },
    [runOperation, needsForcePush],
  );

  const stashChanges = useCallback(
    (message: string) => runOperation(() => gitizen.stashChanges(message)),
    [runOperation],
  );

  const addRemote = useCallback(
    (name: string, url: string) => runOperation(() => gitizen.addRemote(name, url)),
    [runOperation],
  );

  const publishRepository = useCallback(
    async (name: string, description: string, isPrivate: boolean): Promise<boolean> => {
      // Publishing pushes, so the header shows it like a push meanwhile.
      setSyncing("push");
      const ok = await runOperation(() => gitizen.publishRepository(name, description, isPrivate));
      setSyncing(null);
      return ok;
    },
    [runOperation],
  );

  const createBranch = useCallback(
    (name: string, hash: string, checkout: boolean) =>
      runOperation(() => gitizen.createBranch(name, hash, checkout)),
    [runOperation],
  );

  const createTag = useCallback(
    (name: string, hash: string, message: string) =>
      runOperation(() => gitizen.createTag(name, hash, message)),
    [runOperation],
  );

  const cherryPick = useCallback(
    (hash: string, branch: string) => runOperation(() => gitizen.cherryPick(hash, branch)),
    [runOperation],
  );

  const resolveConflict = useCallback(
    (path: string, resolution: Resolution) =>
      runOperation(() => gitizen.resolveConflict(path, resolution)),
    [runOperation],
  );

  const saveConflictResolution = useCallback(
    (path: string, text: string) => runOperation(() => gitizen.saveConflictResolution(path, text)),
    [runOperation],
  );

  // A merge tool is waited for and may stage the file itself; an editor
  // returns at once. Refreshing covers both.
  const openInMergeTool = useCallback(
    (path: string) => runOperation(() => gitizen.openInMergeTool(path)),
    [runOperation],
  );

  const continueOperation = useCallback(
    () => runOperation(gitizen.continueOperation),
    [runOperation],
  );

  const abortOperation = useCallback(
    () => runOperation(gitizen.abortOperation),
    [runOperation],
  );

  const stageLines = useCallback(
    (lines: number[], staged: boolean): Promise<boolean> => {
      // Lines of a whitespace-hidden diff can't be mapped back onto the file.
      if (!selectedFile || lines.length === 0 || hideWhitespace) {
        return Promise.resolve(false);
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
    needsForcePush,
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
    amending,
    startAmend,
    cancelAmend,
    markPushedCommitRewritten,
    undoLastCommit,
    stashChanges,
    checkoutBranch,
    checkoutCommit,
    createBranch,
    createTag,
    cherryPick,
    conflicts,
    selectedConflict,
    setSelectedConflict,
    resolveConflict,
    saveConflictResolution,
    openInMergeTool,
    continueOperation,
    abortOperation,
    generatingMessage,
    generateCommitMessage,
    stageLines,
  };
}
