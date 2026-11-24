import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { OPERATION_NAME } from "../../utils/conflictText";
import ConfirmModal from "../common/ConfirmModal";

/**
 * Abandons the stopped operation after asking, since resolved conflicts
 * are lost. Sits beside the button that finishes it, e.g. "Abort Merge"
 * beside "Commit merge".
 */
export default function AbortOperationButton(): React.JSX.Element | null {
  const {
    conflicts: { operation },
    abortOperation,
  } = useGitOperationsContext();
  const [confirming, setConfirming] = useState(false);
  if (!operation) return null;
  const name = OPERATION_NAME[operation];
  // "Abort Merge", "Abort Cherry-pick", "Abort Stash Pop".
  const label = `Abort ${name.replace(/(^| )\w/g, (start) => start.toUpperCase())}`;

  return (
    <>
      <button onClick={() => setConfirming(true)}>{label}</button>
      {confirming && (
        <ConfirmModal
          title={`Abort the ${name}?`}
          confirmLabel={label}
          onConfirm={() => void abortOperation()}
          onDismiss={() => setConfirming(false)}
        >
          <p>
            Everything will go back to how it was before the {name} started. Any
            conflicts you have resolved will be lost.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
