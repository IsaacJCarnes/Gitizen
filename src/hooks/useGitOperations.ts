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
  ResetMode,
  Resolution,
  StashOutcome,
} from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { toAppError, type AppError } from "../utils/errors";
import { joinMessage, splitMessage } from "../utils/format";
import { attempt, loadOrReset } from "../utils/load";
import { useAutoRefresh } from "./useAutoRefresh";
import { useCommitSelection } from "./useCommitSelection";
import { useDiffSettings } from "./useDiffSettings";
import { useSync, type SyncAction } from "./useSync";

export { BACKGROUND_FETCH_MS, type SyncAction } from "./useSync";

/**
 * What stopped on conflicts with a stash: adding to the branch's stash
 * ("stash"), popping it ("pop"), or bringing changes to another branch
 * ("bring", applied there through a stash).
 */
export type StashConflictKind = "stash" | "pop" | "bring";

/**
 * How clicking a commit changes the selection: "only" selects just it,
 * "toggle" (Ctrl+click) adds or removes it, "range" (Shift+click) selects
 * every commit between the last one clicked and it: those on the line
 * between them when one descends from the other, else every row between.
 */
export type SelectHow = "only" | "toggle" | "range";

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
  /** Creates the repository on the signed-in GitHub account and pushes to it. */
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
  /**
   * Commit chosen in the history; null means "Uncommitted changes". With
   * several selected, the newest of them.
   */
  selectedCommit: GitCommit | null;
  /** Every selected commit, newest first (as in the history); empty for "Uncommitted changes". */
  selectedCommits: GitCommit[];
  /**
   * With several commits selected, the oldest: the files and diffs then
   * show every change from it through `selectedCommit` together. Null otherwise.
   */
  selectionBase: GitCommit | null;
  commitFiles: CommitFile[];
  /** File chosen within the selected commit, and its diff. */
  selectedCommitFile: CommitFile | null;
  commitDiff: string;
  /** Selects `commit` (`how` as for Ctrl/Shift+click), or null for "Uncommitted changes". */
  selectCommit: (commit: GitCommit | null, how?: SelectHow) => void;
  setSelectedCommitFile: (file: CommitFile | null) => void;
  setSelectedFile: (file: FileChange | null) => void;
  setCommitSummary: (summary: string) => void;
  setCommitDescription: (description: string) => void;
  /** Shows the folder picker and opens the chosen repository. Resolves to true once it is open. */
  openRepository: () => Promise<boolean>;
  /** Opens the repository at `path` (e.g. from the recent list) without a picker. */
  openRepositoryAt: (path: string) => Promise<boolean>;
  /** Runs `git init` in `path` (a folder that isn't a repository yet) and opens it. */
  initRepository: (path: string) => Promise<boolean>;
  /** Clones `url` into folder `name` inside `parent` and opens the clone. Resolves to true once open. */
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
  /** Every branch's stash (one per branch), the current branch's first. */
  stashes: BranchStash[];
  /** The current branch's stash, or null. */
  branchStash: BranchStash | null;
  /**
   * Applies and drops `branch`'s stash (the current branch's when left
   * out), switching to that branch first; false on failure or conflicts.
   */
  popStash: (branch?: string) => Promise<boolean>;
  /** Deletes `branch`'s stash (the current branch's when left out) for good. */
  dropStash: (branch?: string) => Promise<boolean>;
  /**
   * The stash selected in the history (like a commit), or null: the
   * sidebar then lists its files with Pop and Discard.
   */
  selectedStash: BranchStash | null;
  /** Selects a stash, leaving any selected commit. `selectCommit` leaves it. */
  selectStash: (stash: BranchStash) => void;
  /** Closes the repository and goes back to the start screen. */
  closeRepository: () => Promise<void>;
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
  /**
   * Hashes of the commits that can be squashed (newest first):
   * the current branch's own, unpushed, unshared commits back to the first merge.
   */
  rewritable: string[];
  /** Adds a commit undoing `hash` to the current branch. */
  revertCommit: (hash: string) => Promise<boolean>;
  /** Moves the current branch back to its earlier commit `hash`. */
  resetToCommit: (hash: string, mode: ResetMode) => Promise<boolean>;
  /** Squashes rewritable commits next to each other into one. */
  squashCommits: (hashes: string[], message: string) => Promise<boolean>;
  deleteTag: (name: string, fromRemote: boolean) => Promise<boolean>;
  pushTag: (name: string) => Promise<boolean>;
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
  /** Called after a commit that left no changed files behind. */
  onWorkingTreeClean?: () => void;
}

/** Unfinished commit messages, per repository path, saved in localStorage. */
type Drafts = Record<string, { summary: string; description: string }>;
const DRAFTS_KEY = "gitizen.commitDrafts";

function loadDrafts(): Drafts {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "null");
    return typeof saved === "object" && saved !== null ? (saved as Drafts) : {};
  } catch {
    return {};
  }
}

/** Saves `repo`'s draft (removing it when both fields are empty). */
function saveDraft(repo: string, summary: string, description: string): void {
  const drafts = loadDrafts();
  if (summary.trim() || description.trim()) drafts[repo] = { summary, description };
  else delete drafts[repo];
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Storage can be full or disabled; the draft still lives this session.
  }
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
  onWorkingTreeClean,
}: GitOperationsOptions = {}): GitOperations {
  const [repo, setRepo] = useState<string | null>(null);
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const [status, setStatus] = useState<GitStatus | null>(null);
  // The status from the last refresh, readable right after an action.
  const statusRef = useRef(status);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [rewritable, setRewritable] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<ConflictState>(NO_CONFLICTS);
  const [stashes, setStashes] = useState<BranchStash[]>([]);
  const [selectedStashFile, setSelectedStashFile] = useState<CommitFile | null>(null);
  // The branch whose stash is selected, so a refresh keeps it selected.
  const [selectedStashBranch, setSelectedStashBranch] = useState<string | null>(null);
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
  // Set when amending a pushed commit; only takes effect once the amend is
  // actually committed (cancelling it leaves the branch as it was).
  const pendingForcePush = useRef(false);
  const {
    settings: { hideWhitespace },
  } = useDiffSettings();

  const reportError = useCallback((caught: unknown): void => {
    setError(toAppError(caught));
  }, []);

  const dismissError = useCallback((): void => setError(null), []);

  // Selecting a commit (or "Uncommitted changes") leaves the stash.
  const leaveStash = useCallback((): void => {
    setSelectedStashBranch(null);
    setSelectedStashFile(null);
  }, []);
  const commitSelection = useCommitSelection({ commits, hideWhitespace, reportError, onSelect: leaveStash });
  const { selectCommit } = commitSelection;

  // ---- Actions -------------------------------------------------------------


  // Closes the repository; set once `closeRepository` is defined below,
  // since `refresh` (defined first) needs it.
  const closeRef = useRef<((reason?: string) => void) | null>(null);

  /** Reloads status, history, branches, remotes and conflicts together. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextStatus, nextCommits, nextBranches, nextRemotes, nextConflicts, nextStash, nextRewritable] =
        await Promise.all([
          gitizen.status(),
          gitizen.log(),
          gitizen.branches(),
          gitizen.remotes(),
          gitizen.conflicts(),
          gitizen.branchStashes(),
          gitizen.rewritableCommits(),
        ]);
      setRewritable(nextRewritable);
      // The current branch's stash first, so it sits next to the commits.
      setStashes(
        [...nextStash].sort(
          (a, b) => Number(b.branch === nextStatus.branch) - Number(a.branch === nextStatus.branch),
        ),
      );
      statusRef.current = nextStatus;
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
      // A repository whose folder was deleted (or is no longer a
      // repository) is closed instead of failing on every refresh.
      const open = repoRef.current;
      if (open && !(await gitizen.repoExists(open).catch(() => true))) {
        closeRef.current?.(`${open} was removed, so Gitizen closed it.`);
        return;
      }
      reportError(refreshError);
    }
  }, [reportError, selectCommit, setMessage]);

  useAutoRefresh(repo, refresh);

  /**
   * Runs a git command, then refreshes. Resolves to false (with the error
   * shown) if it failed, so callers can tell without a try/catch of their own.
   */
  const runOperation = useCallback(
    (operation: () => Promise<unknown>): Promise<boolean> =>
      attempt(async () => {
        await operation();
        await refresh();
      }, reportError),
    [refresh, reportError],
  );

  const { setNeedsForcePush, resetSync, ...sync } = useSync({
    repo,
    hasRemotes: remotes.length > 0,
    runOperation,
    refresh,
  });

  /**
   * Shows `directory` (already opened by the backend), clears the previous
   * repository's selections and reports it as opened. The index is left as
   * it is, so the checkboxes show what is really staged.
   */
  const showRepository = useCallback(
    async (directory: string): Promise<void> => {
      // Each repository keeps its own unfinished commit message.
      const draft = loadDrafts()[directory];
      setMessage(draft?.summary, draft?.description);
      setRepo(directory);
      lastOperation.current = null;
      resetSync();
      setStashConflict(null);
      setAmending(false);
      pendingForcePush.current = false;
      setSelectedFile(null);
      setFileDiff(NO_DIFF);
      selectCommit(null);
      onRepositoryOpened?.(directory);
      // From now on, changes made anywhere (an editor, a terminal) refresh by themselves.
      gitizen.watchRepository().catch(console.error);
      await refresh();
    },
    [refresh, selectCommit, setMessage, onRepositoryOpened, resetSync],
  );

  const closeRepository = useCallback(
    async (reason?: string): Promise<void> => {
      setRepo(null);
      setStatus(null);
      statusRef.current = null;
      setCommits([]);
      setBranches([]);
      setRemotes([]);
      setStashes([]);
      setConflicts(NO_CONFLICTS);
      lastOperation.current = null;
      resetSync();
      setStashConflict(null);
      setAmending(false);
      setSelectedFile(null);
      setFileDiff(NO_DIFF);
      setSelectedConflict(null);
      selectCommit(null);
      setMessage();
      await gitizen.closeRepo().catch(() => undefined);
      if (reason) setError({ kind: "failed", message: reason });
    },
    [selectCommit, setMessage, resetSync],
  );
  closeRef.current = (reason) => void closeRepository(reason);

  // Keep the open repository's draft saved as it is typed (not while
  // amending, whose message is the old commit's, not a draft).
  useEffect(() => {
    if (repo && !amending) saveDraft(repo, commitSummary, commitDescription);
  }, [repo, amending, commitSummary, commitDescription]);

  /**
   * Waits for the backend to open a repository (null: the picker was
   * cancelled), then shows it. Resolves to true once it is shown.
   */
  const openWith = useCallback(
    async (opening: Promise<string | null>): Promise<boolean> => {
      let opened = false;
      const ok = await attempt(async () => {
        const directory = await opening;
        if (directory) {
          await showRepository(directory);
          opened = true;
        }
      }, reportError);
      return ok && opened;
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
    (url: string, parent: string, name: string) => openWith(gitizen.cloneRepository(url, parent, name)),
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

    const committed = await runOperation(async () => {
      // Committing finishes a merge, cherry-pick or revert by itself.
      await gitizen.commit(message, amending);
      if (amending && pendingForcePush.current) setNeedsForcePush(true);
      pendingForcePush.current = false;
      setMessage();
      setAmending(false);
    });
    // Nothing left to commit: there is no diff to look at any more.
    if (committed && statusRef.current?.files.length === 0) onWorkingTreeClean?.();
    return committed;
  }, [
    commitSummary,
    commitDescription,
    amending,
    conflicts.operation,
    runOperation,
    setMessage,
    setNeedsForcePush,
    onWorkingTreeClean,
  ]);

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
  }, [commitSummary, runOperation, selectCommit, setMessage, setNeedsForcePush]);

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
      revertCommit: act(gitizen.revertCommit),
      resetToCommit: act(gitizen.resetToCommit),
      squashCommits: act(gitizen.squashCommits),
      deleteTag: act(gitizen.deleteTag),
      pushTag: act(gitizen.pushTag),
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

  const selectStashFile = useCallback((file: CommitFile | null): void => {
    setSelectedStashFile(file);
    if (file) setSelectedFile(null);
  }, []);

  // Picking a changed file takes over from a stash file.
  useEffect(() => {
    if (selectedFile) setSelectedStashFile(null);
  }, [selectedFile]);

  const popStash = useCallback(
    async (branch?: string): Promise<boolean> => {
      // Another branch's stash pops onto that branch, so switch to it first.
      if (branch && branch !== statusRef.current?.branch) {
        if (!(await checkoutBranch(branch))) return false;
      }
      return runStash("pop", gitizen.popStash);
    },
    [checkoutBranch, runStash],
  );

  const branchStash = useMemo(
    () => stashes.find((stash) => stash.branch === status?.branch) ?? null,
    [stashes, status?.branch],
  );
  const selectedStash = useMemo(
    () => stashes.find((stash) => stash.branch === selectedStashBranch) ?? null,
    [stashes, selectedStashBranch],
  );

  const selectStash = useCallback(
    (stash: BranchStash): void => {
      selectCommit(null);
      setSelectedStashBranch(stash.branch);
    },
    [selectCommit],
  );

  // Keep the stash file picked while the stash still has it, and the stash
  // selected while it exists.
  useEffect(() => {
    if (!selectedStash) setSelectedStashBranch(null);
    setSelectedStashFile((current) =>
      current && selectedStash?.files.find((file) => file.path === current.path) ? current : null,
    );
  }, [selectedStash]);

  // Diff of the picked stash file, against the commit the stash was made on.
  useEffect(
    () =>
      loadOrReset(
        selectedStash &&
          selectedStashFile &&
          gitizen.stashDiff(selectedStash.hash, selectedStashFile.path, hideWhitespace),
        setStashDiff,
        "",
        reportError,
      ),
    [selectedStash, selectedStashFile, hideWhitespace, reportError],
  );

  return {
    ...simpleActions,
    ...sync,
    ...commitSelection,
    checkoutBranch,
    pendingSwitch,
    answerSwitch,
    repo,
    status,
    commits,
    branches,
    remotes,
    rewritable,
    selectedFile,
    diff,
    stagedLines,
    commitSummary,
    commitDescription,
    error,
    reportError,
    dismissError,
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
    stashes,
    branchStash,
    popStash,
    selectedStashFile,
    stashDiff,
    selectStashFile,
    selectedStash,
    selectStash,
    closeRepository: () => closeRepository(),
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
