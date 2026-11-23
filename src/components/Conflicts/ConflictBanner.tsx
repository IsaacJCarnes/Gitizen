import "./Conflicts.css";
import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { OPERATION_NAME } from "../../utils/conflictText";
import { pluralize } from "../../utils/format";
import ActionModal from "../common/ActionModal";

/**
 * Sits above the changed files while a merge, cherry-pick, rebase or revert
 * is stopped: how many conflicts are left (committing is blocked until
 * none), and a button to abort the whole operation.
 */
export default function ConflictBanner(): React.JSX.Element | null {
  const {
    conflicts: { operation, files, incoming, current },
    abortOperation,
  } = useGitOperationsContext();
  const [confirming, setConfirming] = useState(false);
  if (!operation) return null;
  const name = OPERATION_NAME[operation];

  return (
    <div className="conflict-banner">
      <span>
        <b>{name[0].toUpperCase() + name.slice(1)} in progress</b>
        {incoming && current && (
          <span className="conflict-branches" title={`${incoming} into ${current}`}>
            {incoming} → {current}
          </span>
        )}
        <small>
          {files.length > 0
            ? `Resolve ${pluralize(files.length, "conflicted file")} to commit`
            : "All conflicts resolved. Commit to finish it."}
        </small>
      </span>
      <button onClick={() => setConfirming(true)}>Abort</button>
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
            Everything will go back to how it was before the {name} started. Any conflicts you
            have resolved will be lost.
          </p>
        </ActionModal>
      )}
    </div>
  );
}
