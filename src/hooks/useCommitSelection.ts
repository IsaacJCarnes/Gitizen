import { useCallback, useEffect, useRef, useState } from "react";
import type { CommitFile, GitCommit } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { commitsBetween } from "../utils/history";
import { loadOrReset, loadUnlessCancelled } from "../utils/load";
import type { GitOperations, SelectHow } from "./useGitOperations";

type CommitSelection = Pick<
  GitOperations,
  | "selectedCommit"
  | "selectedCommits"
  | "selectionBase"
  | "commitFiles"
  | "selectedCommitFile"
  | "setSelectedCommitFile"
  | "commitDiff"
  | "selectCommit"
>;

interface CommitSelectionOptions {
  /** The history, newest first. */
  commits: GitCommit[];
  hideWhitespace: boolean;
  reportError: (caught: unknown) => void;
  /** Called on every selection change, e.g. to leave the stash. Must be stable. */
  onSelect: () => void;
}

/**
 * The commits selected in the history (one, several with Ctrl/Shift+click,
 * or none for "Uncommitted changes"), the files they changed together, and
 * the diff of the file picked among them. Part of `useGitOperations`, which
 * documents the fields it returns.
 */
export function useCommitSelection({
  commits,
  hideWhitespace,
  reportError,
  onSelect,
}: CommitSelectionOptions): CommitSelection {
  // The selected commits, newest first, and the one clicked last, which a
  // Shift+click range starts from.
  const [selection, setSelection] = useState<GitCommit[]>([]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectionAnchor = useRef<string | null>(null);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const selectedCommit = selection[0] ?? null;
  const selectionBase = selection.length > 1 ? selection[selection.length - 1] : null;
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [commitDiff, setCommitDiff] = useState("");

  // Clear the old commit's files and diff together so a stale file is never
  // diffed against the newly selected commit.
  const selectCommit = useCallback(
    (commit: GitCommit | null, how: SelectHow = "only"): void => {
      const order = commitsRef.current;
      const position = (hash: string): number => order.findIndex((each) => each.hash === hash);
      let next: GitCommit[] = [];
      if (commit && how === "toggle") {
        const current = selectionRef.current;
        next = current.some((each) => each.hash === commit.hash)
          ? current.filter((each) => each.hash !== commit.hash)
          : [...current, commit];
        selectionAnchor.current = commit.hash;
      } else if (commit && how === "range" && selectionAnchor.current) {
        // Along the branch line when one commit descends from the other.
        const between = commitsBetween(order, selectionAnchor.current, commit.hash);
        next = between.length > 0 ? between : [commit];
      } else if (commit) {
        next = [commit];
        selectionAnchor.current = commit.hash;
      } else {
        selectionAnchor.current = null;
      }
      setSelection(next.sort((a, b) => position(a.hash) - position(b.hash)));
      onSelect();
      setCommitFiles([]);
      setSelectedCommitFile(null);
      setCommitDiff("");
    },
    [onSelect],
  );

  // Commits rewritten or gone after a refresh (amended, squashed, reset)
  // leave the selection; with none left, the working tree shows again.
  useEffect(() => {
    const present = new Set(commits.map((commit) => commit.hash));
    const kept = selectionRef.current.filter((commit) => present.has(commit.hash));
    if (kept.length === selectionRef.current.length) return;
    if (kept.length === 0) selectCommit(null);
    else setSelection(kept);
  }, [commits, selectCommit]);

  // Files changed by the selected commit (or commits, together).
  useEffect(() => {
    if (!selectedCommit) return;
    return loadUnlessCancelled(
      gitizen.commitFiles(selectedCommit.hash, selectionBase?.hash),
      setCommitFiles,
      reportError,
    );
  }, [selectedCommit, selectionBase, reportError]);

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
            selectionBase?.hash,
          ),
        setCommitDiff,
        "",
        reportError,
      ),
    [selectedCommit, selectionBase, selectedCommitFile, hideWhitespace, reportError],
  );

  return {
    selectedCommit,
    selectedCommits: selection,
    selectionBase,
    commitFiles,
    selectedCommitFile,
    setSelectedCommitFile,
    commitDiff,
    selectCommit,
  };
}
