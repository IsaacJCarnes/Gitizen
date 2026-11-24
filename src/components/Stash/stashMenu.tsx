import type { GitOperations } from "../../hooks/useGitOperations";
import { pluralize } from "../../utils/format";
import type { MenuItem } from "../common/ContextMenu";
import type { DiscardRequest } from "../common/DiscardConfirm";

/** Why the stash can't be used while a merge (or similar) is stopped. */
export const OPERATION_IN_PROGRESS = "Finish or abort the operation in progress first";

/** What Pop stash does, for its button and menu item. */
export const POP_TITLE =
  "Bring the stashed changes back to the working directory and remove the stash";

/** What `confirmDiscard` needs to drop the current branch's stash. */
export function discardStashRequest({
  branchStash,
  status,
  dropStash,
}: Pick<GitOperations, "branchStash" | "status" | "dropStash">): DiscardRequest {
  return {
    title: "Discard the stash?",
    what: (
      <>
        The stash on <code>{status?.branch ?? "this branch"}</code> (
        {pluralize(branchStash?.files.length ?? 0, "file")})
      </>
    ),
    confirmLabel: "Discard stash",
    run: () => void dropStash(),
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
