import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { OPERATION_NAME } from "../../utils/conflictText";
import ActionModal from "../common/ActionModal";

/**
 * Abandons the stopped operation after asking, since resolved conflicts
 * are lost: in the conflict banner, or beside "Continue rebase".
 */
export default function AbortOperationButton({
  label = "Abort",
}: {
  label?: string;
}): React.JSX.Element | null {
  const {
    conflicts: { operation },
    abortOperation,
  } = useGitOperationsContext();
  const [confirming, setConfirming] = useState(false);
  if (!operation) return null;
  const name = OPERATION_NAME[operation];

  return (
    <>
      <button onClick={() => setConfirming(true)}>{label}</button>
      {confirming && (
        <ActionModal
          title={`Abort the ${name}?`}
          onDismiss={() => setConfirming(false)}
          actions={[
            {
              label: `Abort ${name}`,
              primary: true,
              onClick: () => {
                setConfirming(false);
                void abortOperation();
              },
            },
          ]}
        >
          <p>
            Everything will go back to how it was before the {name} started. Any
            conflicts you have resolved will be lost.
          </p>
        </ActionModal>
      )}
    </>
  );
}
