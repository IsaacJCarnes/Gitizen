import { useState } from "react";
import type { GitBranch } from "../../../shared/gitTypes";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";
import type { MenuEntry } from "../common/ContextMenu";
import { DeleteBranchDialog, RenameBranchDialog, SquashMergeDialog } from "./BranchDialogs";

/** A branch dialog opened from the menu. */
type BranchDialog = { kind: "rename" | "delete" | "squash"; branch: GitBranch };

/**
 * The menu entries for one local branch, used wherever a branch can be
 * right-clicked (the history graph and the branch list): rename, delete,
 * and for another branch with commits the current one lacks, merging it,
 * rebasing onto it, or squashing it into one commit. The merge entries
 * are only offered when `withMerge` is set (the history graph), not in the
 * branch list.
 *
 * Render `branchDialog`; `dialogOpen` says whether one is showing, so a
 * menu can stay mounted until it is closed.
 */
export function useBranchMenu(): {
  branchEntries: (name: string, withMerge?: boolean) => MenuEntry[];
  branchDialog: React.JSX.Element | null;
  dialogOpen: boolean;
} {
  const { branches, status, mergeBranch, rebaseOntoBranch } = useGitOperationsContext();
  const [dialog, setDialog] = useState<BranchDialog | null>(null);

  const branchEntries = (name: string, withMerge = true): MenuEntry[] => {
    const branch = branches.find((candidate) => candidate.name === name);
    if (!branch) return [];
    const entries: MenuEntry[] = [
      { label: `Rename ${name}…`, onSelect: () => setDialog({ kind: "rename", branch }) },
      {
        label: `Delete ${name}…`,
        disabled: branch.current,
        title: branch.current ? "Switch to another branch to delete this one" : undefined,
        onSelect: () => setDialog({ kind: "delete", branch }),
      },
    ];
    if (branch.current || !withMerge) return entries;

    // Bringing the branch in needs a checked-out branch to bring it into,
    // and commits on it that the current branch doesn't have yet.
    const current = status?.branch ?? null;
    let why: string | undefined;
    if (current === null) why = "Check out a branch to bring this one into it";
    else if (branch.ahead === 0) why = `${name} has no commits that ${current} doesn't have`;
    const into = current ?? "the current branch";
    const ahead = pluralize(branch.ahead, "commit");
    entries.push(
      "separator",
      {
        label: `Merge ${name} into ${into}`,
        disabled: Boolean(why),
        title: why ?? `Bring ${name}'s ${ahead} into ${into} with a merge commit`,
        onSelect: () => void mergeBranch(name),
      },
      {
        label: `Rebase ${into} onto ${name}`,
        disabled: Boolean(why),
        title: why ?? `Replay ${into}'s own commits on top of ${name}, keeping history in a line`,
        onSelect: () => void rebaseOntoBranch(name),
      },
      {
        label: `Squash and merge ${name} into ${into}…`,
        disabled: Boolean(why),
        title: why ?? `Bring ${name}'s ${ahead} into ${into} as one new commit`,
        onSelect: () => setDialog({ kind: "squash", branch }),
      },
    );
    return entries;
  };

  const close = (): void => setDialog(null);
  let branchDialog: React.JSX.Element | null = null;
  if (dialog?.kind === "rename") branchDialog = <RenameBranchDialog branch={dialog.branch} onDismiss={close} />;
  if (dialog?.kind === "delete") branchDialog = <DeleteBranchDialog branch={dialog.branch} onDismiss={close} />;
  if (dialog?.kind === "squash") branchDialog = <SquashMergeDialog branch={dialog.branch} onDismiss={close} />;

  return { branchEntries, branchDialog, dialogOpen: dialog !== null };
}
