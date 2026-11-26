import type { BranchStash } from "../../../shared/gitTypes";
import type { GitOperations } from "../../hooks/useGitOperations";
import { pluralize } from "../../utils/format";
import type { MenuItem } from "../common/ContextMenu";
import type { DiscardRequest } from "../common/DiscardConfirm";

/** Why the stash can't be used while a merge (or similar) is stopped. */
export const OPERATION_IN_PROGRESS = "Finish or abort the operation in progress first";

/** What Pop stash does, for its button and menu item. */
export const POP_TITLE =
  "Bring the stashed changes back to the working directory and remove the stash";

/** What `confirmDiscard` needs to drop a branch's stash. */
export function discardStashRequest(
  { dropStash }: Pick<GitOperations, "dropStash">,
  stash: BranchStash,
): DiscardRequest {
  return {
    title: "Discard the stash?",
    what: (
      <>
        The stash on <code>{stash.branch}</code> ({pluralize(stash.files.length, "file")})
      </>
    ),
    confirmLabel: "Discard stash",
    run: () => void dropStash(stash.branch),
  };
}

/** Pop's label and tooltip for `stash`: another branch's is popped after switching to it. */
export function popLabel(stash: BranchStash, currentBranch: string | null | undefined): {
  label: string;
  title: string;
} {
  return stash.branch === currentBranch
    ? { label: "Pop stash", title: POP_TITLE }
    : {
        label: `Switch to ${stash.branch} and pop`,
        title: `Check out ${stash.branch}, then bring its stashed changes back and remove the stash`,
      };
}

/**
 * A menu item that stashes `paths` (every change when empty) on the
 * current branch, e.g. "Stash file". A branch keeps one stash, so when it
 * has one already the item adds to it instead ("Add file to stash").
 */
export function stashItem(
  {
    branchStash,
    status,
    conflicts,
    stashChanges,
  }: Pick<GitOperations, "branchStash" | "status" | "conflicts" | "stashChanges">,
  paths: string[],
  what: string,
): MenuItem {
  let blocked: string | undefined;
  if (conflicts.operation !== null) blocked = OPERATION_IN_PROGRESS;
  else if (status?.branch === null) blocked = "Check out a branch to stash changes on it";
  return {
    label: branchStash ? `Add ${what} to stash` : `Stash ${what}`,
    disabled: Boolean(blocked),
    title:
      blocked ??
      (branchStash
        ? `Add to the stash on ${status?.branch}, which then holds both`
        : `Set aside in a stash on ${status?.branch}, to bring back later`),
    onSelect: () => void stashChanges("", paths),
  };
}
