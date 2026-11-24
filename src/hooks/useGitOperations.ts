import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchStash,
  ChangesOnSwitch,
  CommitFile,
  ConflictState,
  FileChange,
  FileDiff,
  GitBranch,
  GitCommit,
  GitStatus,
  Remote,
  Resolution,
  StashOutcome,
} from "../../shared/gitTypes";
import { listen } from "@tauri-apps/api/event";
import { REPOSITORY_CHANGED } from "../../shared/ipc";
import { gitizen } from "../api/gitizen";
import { toAppError, type AppError } from "../utils/errors";
import { joinMessage, splitMessage } from "../utils/format";
import { loadOrReset, loadUnlessCancelled } from "../utils/load";
import { useDiffSettings } from "./useDiffSettings";

/**
 * What stopped on conflicts with a stash: adding to the branch's stash
 * ("stash"), popping it ("pop"), or bringing changes to another branch
 * ("bring", applied there through a stash).
 */
export type StashConflictKind = "stash" | "pop" | "bring";

/** A network operation the header's sync buttons can run. */
export type SyncAction = "fetch" | "pull" | "push";

/** How often the open repository is fetched in the background. */
export const BACKGROUND_FETCH_MS = 5 * 60 * 1000;

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
   * When the remotes were last fetched (milliseconds since 1970), by the
   * Fetch button or the background fetch every few minutes; null if not yet.
   */
  lastFetched: number | null;
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
  /** Clones `url` into folder `name` inside `parent` and opens the clone. */
  cloneRepository: (url: string, parent: string, name: string) => Promise<boolean>;
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
  /**
   * Stashes `paths` (all changes when left out) into the current branch's
   * stash. Resolves to true once stashed; false on failure, or when adding
   * to the stash stopped on conflicts (see `stashConflict`).
   */
  stashChanges: (message: string, paths?: string[]) => Promise<boolean>;
  /** The current branch's stash, or null. */
  branchStash: BranchStash | null;
  /** Applies and drops the branch's stash; false on failure or conflicts. */
  popStash: () => Promise<boolean>;
  /** Deletes the branch's stash for good. */
  dropStash: () => Promise<boolean>;
  /**
   * True while the stash is selected in the history (like a commit): the
   * sidebar then lists its files with Pop and Discard.
   */
  stashSelected: boolean;
  /** Selects the stash, leaving any selected commit. `selectCommit` leaves it. */
  selectStash: () => void;
  /** File of the selected stash picked in the sidebar, and its diff. */
  selectedStashFile: CommitFile | null;
  stashDiff: string;
  /** Shows a stash file's diff (or clears it); picking a changed file clears it again. */
  selectStashFile: (file: CommitFile | null) => void;
  /**
   * Set when stashing ("stash") or popping ("pop") just stopped on
   * conflicts, so the UI can warn before the user resolves them.
   */
  stashConflict: StashConflictKind | null;
  dismissStashConflict: () => void;
  /**
   * Switches to `branch`. With uncommitted changes, first asks (through
   * `pendingSwitch`) whether to leave them on the current branch or bring
   * them along, and resolves once that is answered and done.
   */
  checkoutBranch: (branch: string) => Promise<boolean>;
  /** The branch waiting to be switched to until the user says what to do with the changes. */
  pendingSwitch: string | null;
  /** Answers `pendingSwitch`: leave or bring the changes, or null to stay put. */
  answerSwitch: (changes: ChangesOnSwitch | null) => Promise<void>;
  /** Checks out a commit itself (detached HEAD). */
  checkoutCommit: (hash: string) => Promise<boolean>;
  /** Creates a branch at `hash`, switching to it when `checkout`. */
  createBranch: (name: string, hash: string, checkout: boolean) => Promise<boolean>;
  /** Tags `hash`. */
  createTag: (name: string, hash: string, message: string) => Promise<boolean>;
  /** Cherry-picks `hash` onto `branch` (switching to it). */
  cherryPick: (hash: string, branch: string) => Promise<boolean>;
  renameBranch: (name: string, newName: string) => Promise<boolean>;
  /** Deletes a local branch; `force` also deletes unmerged commits. */
  deleteBranch: (name: string, force: boolean) => Promise<boolean>;
  /** Merges `name` into the current branch (conflicts open the conflict editor). */
  mergeBranch: (name: string) => Promise<boolean>;
  /** Rebases the current branch onto `name`. */
  rebaseOntoBranch: (name: string) => Promise<boolean>;
  /** Squashes `name`'s changes into one commit on the current branch. */
  squashMergeBranch: (name: string, message: string) => Promise<boolean>;
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
  /** Throws away every change to the given paths (both paths of a rename). */
  discardFiles: (paths: string[]) => Promise<boolean>;
  /**
   * Throws away single changed lines of the selected file. Like
   * `stageLines`, does nothing while whitespace changes are hidden.
   */
  discardLines: (lines: number[]) => Promise<boolean>;
  /**
   * Saves edited text over a working-tree file, then shows that file's
   * uncommitted diff (switching away from a selected commit).
   */
  saveWorkingFile: (path: string, text: string) => Promise<boolean>;
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
  step: null,
};

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
  // Read by the background fetch, which mustn't run alongside a sync.
  const syncingRef = useRef(syncing);
  syncingRef.current = syncing;
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const lastFetchedRef = useRef(0);
  // The background fetch while it runs; a sync waits for it first.
  const backgroundFetch = useRef<Promise<void> | null>(null);
  const [conflicts, setConflicts] = useState<ConflictState>(NO_CONFLICTS);
  const [branchStash, setBranchStash] = useState<BranchStash | null>(null);
  const [selectedStashFile, setSelectedStashFile] = useState<CommitFile | null>(null);
  const [stashSelected, setStashSelected] = useState(false);
  const [stashDiff, setStashDiff] = useState("");
  const [stashConflict, setStashConflict] = useState<StashConflictKind | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  // Settles the `checkoutBranch` call waiting on `pendingSwitch`.
  const settleSwitch = useRef<((switched: boolean) => void) | null>(null);
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
  // Set when amending a pushed commit; only takes effect once the amend is
  // actually committed (cancelling it leaves the branch as it was).
  const pendingForcePush = useRef(false);
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
    setStashSelected(false);
    setSelectedStashFile(null);
    setCommitFiles([]);
    setSelectedCommitFile(null);
    setCommitDiff("");
  }, []);

  /** Reloads status, history, branches, remotes and conflicts together. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches, nextRemotes, nextConflicts, nextStash] =
        await Promise.all([
          gitizen.status(),
          gitizen.log(),
          gitizen.branches(),
          gitizen.remotes(),
          gitizen.conflicts(),
          gitizen.branchStash(),
        ]);
      setBranchStash(nextStash);
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
          // A rebase keeps each commit's own message, so it needs none.
          const prepared = nextConflicts.operation === "rebase" ? null : nextConflicts.message;
          if (prepared && !summaryRef.current.trim()) {
            setMessage(...splitMessage(prepared));
          }
        }
        lastOperation.current = nextConflicts.operation;
      }
    } catch (refreshError) {
      reportError(refreshError);
    }
  }, [reportError, selectCommit, setMessage]);

  // Refreshes whenever the watched repository changes on disk, and on
  // coming back to the window. A change during a refresh refreshes once
  // more afterwards, so the last change is never missed.
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  useEffect(() => {
    if (!repo) return;
    const refreshSoon = async (): Promise<void> => {
      if (refreshing.current) {
        refreshAgain.current = true;
        return;
      }
      refreshing.current = true;
      do {
        refreshAgain.current = false;
        await refresh();
      } while (refreshAgain.current);
      refreshing.current = false;
    };
    const onChange = (): void => void refreshSoon();
    const unlisten = listen(REPOSITORY_CHANGED, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
      window.removeEventListener("focus", onChange);
    };
  }, [repo, refresh]);

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
      // A newly opened repository is fetched in the background right away.
      lastFetchedRef.current = 0;
      setLastFetched(null);
      setStashConflict(null);
      setAmending(false);
      setNeedsForcePush(false);
      pendingForcePush.current = false;
      setSelectedFile(null);
      setFileDiff(NO_DIFF);
      selectCommit(null);
      onRepositoryOpened?.(directory);
      // From now on, changes made anywhere (an editor, a terminal) refresh by themselves.
      gitizen.watchRepository().catch(console.error);
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
  const cloneRepository = useCallback(
    async (url: string, parent: string, name: string): Promise<boolean> => {
      try {
        await showRepository(await gitizen.cloneRepository(url, parent, name));
        return true;
      } catch (cloneError) {
        reportError(cloneError);
        return false;
      }
    },
    [showRepository, reportError],
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
    // A rebase step is committed by git itself with the commit's own
    // message (or dropped, if the resolution left nothing to commit), so it
    // needs no summary and never runs `git commit` here.
    if (conflicts.operation === "rebase") {
      return runOperation(async () => {
        await gitizen.continueOperation();
        setMessage();
      });
    }
    if (!commitSummary.trim()) return false;
    const message = joinMessage(commitSummary, commitDescription);

    return runOperation(async () => {
      // Committing finishes a merge, cherry-pick or revert by itself.
      await gitizen.commit(message, amending);
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

  /** Notes a successful fetch. */
  const fetched = useCallback((): void => {
    lastFetchedRef.current = Date.now();
    setLastFetched(lastFetchedRef.current);
  }, []);

  const sync = useCallback(
    async (action: SyncAction): Promise<boolean> => {
      setSyncing(action);
      // Two git network commands at once could trip over each other's locks.
      await backgroundFetch.current;
      const run = {
        fetch: async () => {
          await gitizen.fetch();
          fetched();
        },
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
    [runOperation, needsForcePush, fetched],
  );

  /**
   * Fetches quietly, then refreshes the ahead/behind counts. Failures (no
   * network, not signed in) are ignored; the next round tries again.
   */
  const fetchInBackground = useCallback((): void => {
    if (backgroundFetch.current || syncingRef.current) return;
    // Counts as fetched even on failure, so an offline repository isn't retried every minute.
    lastFetchedRef.current = Date.now();
    backgroundFetch.current = gitizen
      .fetch(true)
      .then(async () => {
        fetched();
        await refresh();
      })
      .catch(() => {})
      .finally(() => {
        backgroundFetch.current = null;
      });
  }, [fetched, refresh]);

  // Fetch in the background when a repository with remotes opens, then
  // every few minutes, and on coming back to the window once that is due.
  const hasRemotes = remotes.length > 0;
  useEffect(() => {
    if (!repo || !hasRemotes) return;
    const fetchIfDue = (): void => {
      if (Date.now() - lastFetchedRef.current >= BACKGROUND_FETCH_MS) fetchInBackground();
    };
    fetchIfDue();
    const timer = window.setInterval(fetchIfDue, 30_000);
    window.addEventListener("focus", fetchIfDue);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", fetchIfDue);
    };
  }, [repo, hasRemotes, fetchInBackground]);

  /**
   * Runs a stash call. Stopping on conflicts counts as not done, and
   * records `kind` so the UI can warn about them.
   */
  const runStash = useCallback(
    async (kind: StashConflictKind, call: () => Promise<StashOutcome>): Promise<boolean> => {
      let conflicted = false;
      const ok = await runOperation(async () => {
        conflicted = (await call()) === "conflicts";
      });
      if (conflicted) setStashConflict(kind);
      return ok && !conflicted;
    },
    [runOperation],
  );

  const stashChanges = useCallback(
    (message: string, paths?: string[]) =>
      runStash("stash", () => gitizen.stashChanges(message, paths)),
    [runStash],
  );

  const popStash = useCallback(() => runStash("pop", gitizen.popStash), [runStash]);

  const dismissStashConflict = useCallback((): void => setStashConflict(null), []);

  const checkoutBranch = useCallback(
    (branch: string): Promise<boolean> => {
      if (!status?.files.length) return runOperation(() => gitizen.checkout(branch));
      // Ask first; a switch still waiting on an answer is dropped.
      settleSwitch.current?.(false);
      setPendingSwitch(branch);
      return new Promise((resolve) => {
        settleSwitch.current = resolve;
      });
    },
    [status, runOperation],
  );

  const answerSwitch = useCallback(
    async (changes: ChangesOnSwitch | null): Promise<void> => {
      const settle = settleSwitch.current;
      settleSwitch.current = null;
      setPendingSwitch(null);
      if (!pendingSwitch || !changes) {
        settle?.(false);
        return;
      }
      // Leaving them may stop on conflicts with the branch's stash, which
      // the stash conflict warning then explains.
      const kind = changes === "leave" ? "stash" : "bring";
      settle?.(await runStash(kind, () => gitizen.switchBranch(pendingSwitch, changes)));
    },
    [pendingSwitch, runStash],
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

  // Actions that are a single backend call (taking the same arguments)
  // followed by a refresh.
  const simpleActions = useMemo(() => {
    const act =
      <A extends unknown[]>(call: (...args: A) => Promise<unknown>) =>
      (...args: A): Promise<boolean> =>
        runOperation(() => call(...args));
    return {
      checkoutCommit: act(gitizen.checkoutCommit),
      addRemote: act(gitizen.addRemote),
      createBranch: act(gitizen.createBranch),
      createTag: act(gitizen.createTag),
      cherryPick: act(gitizen.cherryPick),
      renameBranch: act(gitizen.renameBranch),
      deleteBranch: act(gitizen.deleteBranch),
      mergeBranch: act(gitizen.mergeBranch),
      rebaseOntoBranch: act(gitizen.rebaseOntoBranch),
      squashMergeBranch: act(gitizen.squashMergeBranch),
      dropStash: act(gitizen.dropStash),
      discardFiles: act(gitizen.discardFiles),
      resolveConflict: act(gitizen.resolveConflict),
      saveConflictResolution: act(gitizen.saveConflictResolution),
      // A merge tool is waited for and may stage the file itself; an editor
      // returns at once. Refreshing covers both.
      openInMergeTool: act(gitizen.openInMergeTool),
      continueOperation: act(gitizen.continueOperation),
      abortOperation: act(gitizen.abortOperation),
    };
  }, [runOperation]);

  /** Runs `call` on the selected file's path, for an action on some of its diff's lines. */
  const runOnLines = useCallback(
    (lines: number[], call: (path: string) => Promise<unknown>): Promise<boolean> => {
      // Lines of a whitespace-hidden diff can't be mapped back onto the file.
      if (!selectedFile || lines.length === 0 || hideWhitespace) {
        return Promise.resolve(false);
      }
      return runOperation(() => call(selectedFile.path));
    },
    [selectedFile, hideWhitespace, runOperation],
  );

  const stageLines = useCallback(
    (lines: number[], staged: boolean) =>
      runOnLines(lines, (path) => gitizen.setStagedLines(path, diff, lines, staged)),
    [runOnLines, diff],
  );

  const discardLines = useCallback(
    (lines: number[]) => runOnLines(lines, (path) => gitizen.discardLines(path, diff, lines)),
    [runOnLines, diff],
  );

  const saveWorkingFile = useCallback(
    async (path: string, text: string): Promise<boolean> => {
      const saved = await runOperation(() => gitizen.saveWorkingFile(path, text));
      if (saved) {
        // The file is now among the changes (unless the text was the same),
        // so show it there. The next refresh corrects the entry's details.
        selectCommit(null);
        setSelectedFile((current) =>
          current?.path === path ? current : { path, staged: false, code: "M" },
        );
      }
      return saved;
    },
    [runOperation, selectCommit],
  );

  // ---- Derived data loading ------------------------------------------------

  // Diff of the selected working-tree file against HEAD, staged and unstaged
  // changes together, so staging doesn't change it (only which lines are
  // ticked). Reloaded after every refresh because editing the file does.
  useEffect(
    () =>
      loadOrReset(
        selectedFile && gitizen.fileDiff(selectedFile.path, hideWhitespace),
        setFileDiff,
        NO_DIFF,
        reportError,
      ),
    [selectedFile, status, hideWhitespace, reportError],
  );

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

  const selectStashFile = useCallback((file: CommitFile | null): void => {
    setSelectedStashFile(file);
    if (file) setSelectedFile(null);
  }, []);

  // Picking a changed file takes over from a stash file.
  useEffect(() => {
    if (selectedFile) setSelectedStashFile(null);
  }, [selectedFile]);

  const selectStash = useCallback((): void => {
    selectCommit(null);
    setStashSelected(true);
  }, [selectCommit]);

  // Keep the stash file picked while the stash still has it, and the stash
  // selected while it exists.
  useEffect(() => {
    if (!branchStash) setStashSelected(false);
    setSelectedStashFile((current) =>
      current && branchStash?.files.find((file) => file.path === current.path) ? current : null,
    );
  }, [branchStash]);

  // Diff of the picked stash file, against the commit the stash was made on.
  useEffect(
    () =>
      loadOrReset(
        branchStash &&
          selectedStashFile &&
          gitizen.stashDiff(branchStash.hash, selectedStashFile.path, hideWhitespace),
        setStashDiff,
        "",
        reportError,
      ),
    [branchStash, selectedStashFile, hideWhitespace, reportError],
  );

  // Diff of the file chosen within the selected commit.
  useEffect(
    () =>
      loadOrReset(
        selectedCommit &&
          selectedCommitFile &&
          gitizen.commitDiff(
            selectedCommit.hash,
            selectedCommitFile.path,
            selectedCommitFile.oldPath,
            hideWhitespace,
          ),
        setCommitDiff,
        "",
        reportError,
      ),
    [selectedCommit, selectedCommitFile, hideWhitespace, reportError],
  );

  return {
    ...simpleActions,
    checkoutBranch,
    pendingSwitch,
    answerSwitch,
    repo,
    status,
    commits,
    branches,
    remotes,
    syncing,
    sync,
    lastFetched,
    needsForcePush,
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
    cloneRepository,
    refresh,
    setFilesStaged,
    commitChanges,
    amending,
    startAmend,
    cancelAmend,
    markPushedCommitRewritten,
    undoLastCommit,
    stashChanges,
    branchStash,
    popStash,
    selectedStashFile,
    stashDiff,
    selectStashFile,
    stashSelected,
    selectStash,
    stashConflict,
    dismissStashConflict,
    conflicts,
    selectedConflict,
    setSelectedConflict,
    generatingMessage,
    generateCommitMessage,
    stageLines,
    discardLines,
    saveWorkingFile,
  };
}
