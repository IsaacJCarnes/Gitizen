import { useState } from "react";
import type { ConflictFile } from "../../../shared/gitTypes";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ConfirmModal from "../common/ConfirmModal";

/**
 * Stages a conflicted file as it is now, telling git it is resolved. If the
 * file still has conflict markers, asks first, since they would be committed.
 */
export default function MarkResolvedButton({ file }: { file: ConflictFile }): React.JSX.Element {
  const { resolveConflict } = useGitOperationsContext();
  const [confirming, setConfirming] = useState(false);
  const resolve = (): void => void resolveConflict(file.path, "asIs");

  return (
    <>
      <button
        className={`mini${file.hasMarkers ? "" : " primary"}`}
        title="Stage the file as it is now, telling git it is resolved"
        onClick={() => (file.hasMarkers ? setConfirming(true) : resolve())}
      >
        Mark resolved
      </button>
      {confirming && (
        <ConfirmModal
          title="Mark resolved with conflict markers?"
          confirmLabel="Mark resolved anyway"
          onConfirm={resolve}
          onDismiss={() => setConfirming(false)}
        >
          <p>
            <code>{file.path}</code> still has <code>{"<<<<<<<"}</code> conflict markers, which would
            be committed as they are. Open it to pick the lines to keep and save first, unless the
            markers really belong in the file.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
