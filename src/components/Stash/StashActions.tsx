import "./Stash.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import { discardStashRequest, OPERATION_IN_PROGRESS, POP_TITLE } from "./stashMenu";

/**
 * Takes the commit form's place while the stash is selected: Pop brings
 * its changes back to the working directory and removes it, Discard
 * deletes it for good (after the usual warning).
 */
export default function StashActions(): React.JSX.Element | null {
  const git = useGitOperationsContext();
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const [working, setWorking] = useState(false);
  if (!git.branchStash) return discardDialog;
  const blocked = git.conflicts.operation !== null ? OPERATION_IN_PROGRESS : undefined;
  const busy = working || Boolean(blocked);

  const pop = (): void => {
    setWorking(true);
    void git.popStash().finally(() => setWorking(false));
  };

  return (
    <div className="commit stash-actions">
      <button className="primary" disabled={busy} title={blocked ?? POP_TITLE} onClick={pop}>
        {working ? "Popping…" : "Pop stash"}
      </button>
      <button
        disabled={busy}
        title={blocked ?? "Delete the stash for good"}
        onClick={() => confirmDiscard(discardStashRequest(git))}
      >
        Discard stash
      </button>
      {discardDialog}
    </div>
  );
}
