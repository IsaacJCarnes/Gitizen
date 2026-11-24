import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ActionModal from "../common/ActionModal";

/**
 * The warning shown when stashing (adding to the branch's stash) or popping
 * the stash runs into conflicts: resolve them in the conflict editor, or
 * cancel to put everything back exactly as it was.
 */
export default function StashConflictModal(): React.JSX.Element | null {
  const { stashConflict, dismissStashConflict, abortOperation, conflicts, status } =
    useGitOperationsContext();
  if (!stashConflict) return null;
  const branch = status?.branch ?? "this branch";
  const files = conflicts.files.map((file) => file.path);

  const cancel = (): void => {
    dismissStashConflict();
    void abortOperation();
  };

  return (
    <ActionModal
      title={stashConflict === "stash" ? "These changes conflict with the stash" : "The stash conflicts with your branch"}
      onDismiss={cancel}
      actions={[{ label: "Resolve conflicts", primary: true, onClick: dismissStashConflict }]}
    >
      <p>
        {stashConflict === "stash"
          ? `The changes you are stashing and the stash already on ${branch} both change the same lines in:`
          : `The stash and ${branch} both change the same lines in:`}
      </p>
      <ul>
        {files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
      <p>
        {stashConflict === "stash"
          ? "Resolve the conflicts to save everything together as one stash, or cancel to leave the stash and your changes as they were."
          : "Resolve the conflicts to finish popping it (the stash is removed once you finish), or cancel to leave the stash and your changes as they were."}
      </p>
    </ActionModal>
  );
}
