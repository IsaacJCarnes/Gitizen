import "./Stash.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";
import { useDiscardConfirmation } from "../common/DiscardConfirm";

/**
 * Takes the commit form's place while the stash is selected: Pop brings
 * its changes back to the working directory and removes it, Discard
 * deletes it for good (after the usual warning).
 */
export default function StashActions(): React.JSX.Element | null {
  const { branchStash, popStash, dropStash, status, conflicts } = useGitOperationsContext();
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const [working, setWorking] = useState(false);
  if (!branchStash) return discardDialog;
  const busy = working || conflicts.operation !== null;
  const blocked = conflicts.operation !== null ? "Finish or abort the operation in progress first" : undefined;

  const pop = (): void => {
    setWorking(true);
    void popStash().finally(() => setWorking(false));
  };

  const discard = (): void =>
    confirmDiscard({
      title: "Discard the stash?",
      what: (
        <>
          The stash on <code>{status?.branch ?? "this branch"}</code> (
          {pluralize(branchStash.files.length, "file")})
        </>
      ),
      confirmLabel: "Discard stash",
      run: () => void dropStash(),
    });

  return (
    <div className="commit stash-actions">
      <button
        className="primary"
        disabled={busy}
        title={blocked ?? "Bring the stashed changes back to the working directory and remove the stash"}
        onClick={pop}
      >
        {working ? "Popping…" : "Pop stash"}
      </button>
      <button disabled={busy} title={blocked ?? "Delete the stash for good"} onClick={discard}>
        Discard stash
      </button>
      {discardDialog}
    </div>
  );
}
