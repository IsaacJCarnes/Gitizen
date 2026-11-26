import { useCallback, useEffect, useMemo, useState } from "react";
import type { BranchStash, CommitFile } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { loadOrReset } from "../utils/load";

interface StashSelectionOptions {
  /** Every branch's stash, from the last refresh. */
  stashes: BranchStash[];
  hideWhitespace: boolean;
  reportError: (caught: unknown) => void;
}

interface StashSelection {
  /** The stash selected in the history, or null. */
  selectedStash: BranchStash | null;
  /** Selects `branch`'s stash; call `selectCommit(null)` first, which leaves any other. */
  selectStashOf: (branch: string) => void;
  /** Deselects the stash (a commit or "Uncommitted changes" was picked). Stable. */
  leaveStash: () => void;
  /** File of the selected stash picked in the sidebar, and its diff. */
  selectedStashFile: CommitFile | null;
  setSelectedStashFile: (file: CommitFile | null) => void;
  stashDiff: string;
}

/**
 * The stash selected in the history (like a commit), the file picked
 * among its files and that file's diff. Part of `useGitOperations`, as
 * `useCommitSelection` is for commits.
 */
export function useStashSelection({ stashes, hideWhitespace, reportError }: StashSelectionOptions): StashSelection {
  // The branch whose stash is selected, so a refresh keeps it selected.
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedStashFile, setSelectedStashFile] = useState<CommitFile | null>(null);
  const [stashDiff, setStashDiff] = useState("");

  const leaveStash = useCallback((): void => {
    setSelectedBranch(null);
    setSelectedStashFile(null);
  }, []);

  const selectedStash = useMemo(
    () => stashes.find((stash) => stash.branch === selectedBranch) ?? null,
    [stashes, selectedBranch],
  );

  // Keep the stash file picked while the stash still has it, and the stash
  // selected while it exists.
  useEffect(() => {
    if (!selectedStash) setSelectedBranch(null);
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
    selectedStash,
    selectStashOf: setSelectedBranch,
    leaveStash,
    selectedStashFile,
    setSelectedStashFile,
    stashDiff,
  };
}
