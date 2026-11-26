import "./Stash.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import { discardStashRequest, OPERATION_IN_PROGRESS, popLabel } from "./stashMenu";

/**
 * Takes the commit form's place while a stash is selected: Pop brings
 * its changes back to the working directory and removes it (switching to
 * its branch first when it is another branch's), Discard deletes it for
 * good (after the usual warning).
 */
export default function StashActions(): React.JSX.Element | null {
  const git = useGitOperationsContext();
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const [working, setWorking] = useState(false);
  const stash = git.selectedStash;
  if (!stash) return discardDialog;
  const blocked = git.conflicts.operation !== null ? OPERATION_IN_PROGRESS : undefined;
  const busy = working || Boolean(blocked);
  const pop = popLabel(stash, git.status?.branch);

  const popIt = (): void => {
    setWorking(true);
    void git.popStash(stash.branch).finally(() => setWorking(false));
  };

  return (
    <div className="commit stash-actions">
      <button className="primary" disabled={busy} title={blocked ?? pop.title} onClick={popIt}>
        {working ? "Popping…" : pop.label}
      </button>
      <button
        disabled={busy}
        title={blocked ?? "Delete the stash for good"}
        onClick={() => confirmDiscard(discardStashRequest(git, stash))}
      >
        Discard stash
      </button>
      {discardDialog}
    </div>
  );
}
