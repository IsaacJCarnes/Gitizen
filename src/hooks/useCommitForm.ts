import { useCallback, useEffect, useRef, useState } from "react";
import type { ConflictState, GitCommit, GitStatus } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { loadDraft, saveDraft } from "../utils/commitDrafts";
import { joinMessage, splitMessage } from "../utils/format";
import type { GitOperations } from "./useGitOperations";

type CommitFormState = Pick<
  GitOperations,
  | "commitSummary"
  | "setCommitSummary"
  | "commitDescription"
  | "setCommitDescription"
  | "commitChanges"
  | "amending"
  | "startAmend"
  | "cancelAmend"
  | "markPushedCommitRewritten"
  | "undoLastCommit"
  | "generatingMessage"
  | "generateCommitMessage"
> & {
  /**
   * Starts the form for `repo` (its saved draft, out of amend mode), or
   * clears it when the repository closes (null).
   */
  resetForm: (repo: string | null) => void;
  /** Starts the form with git's prepared message, unless a summary is already written. */
  fillPreparedMessage: (message: string) => void;
};

interface CommitFormOptions {
  /** The open repository, whose draft the form keeps saved. */
  repo: string | null;
  /** The stopped operation, if any; a rebase step commits differently. */
  operation: ConflictState["operation"];
  /** `useGitOperations`' runner: runs a call, refreshes, and shows failures. */
  runOperation: (operation: () => Promise<unknown>) => Promise<boolean>;
  selectCommit: GitOperations["selectCommit"];
  reportError: (caught: unknown) => void;
  /** Called with true once a pushed commit was rewritten, so the next push forces. */
  setNeedsForcePush: (needed: boolean) => void;
  /** The status from the last refresh, read right after committing. */
  statusRef: React.MutableRefObject<GitStatus | null>;
  /** Called after a commit that left no changed files behind. */
  onWorkingTreeClean?: () => void;
}

/**
 * The commit form: summary and description (kept as a draft per
 * repository), amending and undoing the last commit, committing, and the AI
 * commit message. Part of `useGitOperations`, which documents the fields it
 * returns.
 */
export function useCommitForm({
  repo,
  operation,
  runOperation,
  selectCommit,
  reportError,
  setNeedsForcePush,
  statusRef,
  onWorkingTreeClean,
}: CommitFormOptions): CommitFormState {
  const [commitSummary, setCommitSummary] = useState("");
  // The summary as typed, readable without re-creating callbacks on every keystroke.
  const summaryRef = useRef(commitSummary);
  summaryRef.current = commitSummary;
  const [commitDescription, setCommitDescription] = useState("");
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [amending, setAmending] = useState(false);
  // Set when amending a pushed commit; only takes effect once the amend is
  // actually committed (cancelling it leaves the branch as it was).
  const pendingForcePush = useRef(false);

  /** Fills both fields at once; no arguments clears them. */
  const setMessage = useCallback((summary = "", description = ""): void => {
    setCommitSummary(summary);
    setCommitDescription(description);
  }, []);

  const resetForm = useCallback(
    (next: string | null): void => {
      // Each repository keeps its own unfinished commit message.
      const draft = next ? loadDraft(next) : undefined;
      setMessage(draft?.summary, draft?.description);
      setAmending(false);
      pendingForcePush.current = false;
    },
    [setMessage],
  );

  const fillPreparedMessage = useCallback(
    (message: string): void => {
      if (!summaryRef.current.trim()) setMessage(...splitMessage(message));
    },
    [setMessage],
  );

  // Keep the open repository's draft saved as it is typed (not while
  // amending, whose message is the old commit's, not a draft).
  useEffect(() => {
    if (repo && !amending) saveDraft(repo, commitSummary, commitDescription);
  }, [repo, amending, commitSummary, commitDescription]);

  const commitChanges = useCallback(async (): Promise<boolean> => {
    // A rebase step is committed by git itself with the commit's own
    // message (or dropped, if the resolution left nothing to commit), so it
    // needs no summary and never runs `git commit` here.
    if (operation === "rebase") {
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
    operation,
    runOperation,
    setMessage,
    setNeedsForcePush,
    statusRef,
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

  const undoLastCommit = useCallback(
    async (commit: GitCommit, branch?: string): Promise<void> => {
      await runOperation(async () => {
        // Another branch's tip: switch to that branch so it is the last commit.
        if (branch) await gitizen.checkout(branch);
        await gitizen.undoLastCommit();
        if (pendingForcePush.current) setNeedsForcePush(true);
        pendingForcePush.current = false;
        setAmending(false);
        // Don't overwrite a message the user is already writing.
        if (!summaryRef.current.trim()) setMessage(commit.message, commit.body);
        selectCommit(null);
      });
    },
    [runOperation, selectCommit, setMessage, setNeedsForcePush],
  );

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

  return {
    commitSummary,
    setCommitSummary,
    commitDescription,
    setCommitDescription,
    commitChanges,
    amending,
    startAmend,
    cancelAmend,
    markPushedCommitRewritten,
    undoLastCommit,
    generatingMessage,
    generateCommitMessage,
    resetForm,
    fillPreparedMessage,
  };
}
