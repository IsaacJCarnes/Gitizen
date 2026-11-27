import { useCallback, useRef, useState } from "react";
import type { ChangesOnSwitch, GitStatus, StashOutcome } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import type { GitOperations, StashConflictKind } from "./useGitOperations";

type BranchSwitch = Pick<GitOperations, "checkoutBranch" | "pendingSwitch" | "answerSwitch">;

interface BranchSwitchOptions {
  status: GitStatus | null;
  /** `useGitOperations`' runner: runs a call, refreshes, and shows failures. */
  runOperation: (operation: () => Promise<unknown>) => Promise<boolean>;
  /** Runs a stash call, noting `kind` when it stops on conflicts. */
  runStash: (kind: StashConflictKind, call: () => Promise<StashOutcome>) => Promise<boolean>;
}

/**
 * Switching branches: straight away with a clean working tree, else after
 * asking (through `pendingSwitch`) whether to leave the changes on the
 * current branch or bring them along. Part of `useGitOperations`, which
 * documents the fields it returns.
 */
export function useBranchSwitch({ status, runOperation, runStash }: BranchSwitchOptions): BranchSwitch {
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  // Settles the `checkoutBranch` call waiting on `pendingSwitch`.
  const settleSwitch = useRef<((switched: boolean) => void) | null>(null);

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

  return { checkoutBranch, pendingSwitch, answerSwitch };
}
