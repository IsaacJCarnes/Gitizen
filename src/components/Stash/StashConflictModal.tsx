import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ActionModal from "../common/ActionModal";

/**
 * The warning shown when stashing (adding to the branch's stash), popping
 * the stash, or bringing changes to another branch runs into conflicts:
 * resolve them in the conflict editor, or cancel to undo it.
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

  const text = {
    stash: {
      title: "These changes conflict with the stash",
      intro: `The changes you are stashing and the stash already on ${branch} both change the same lines in:`,
      outro:
        "Resolve the conflicts to save everything together as one stash, or cancel to leave the stash and your changes as they were.",
    },
    pop: {
      title: "The stash conflicts with your branch",
      intro: `The stash and ${branch} both change the same lines in:`,
      outro:
        "Resolve the conflicts to finish popping it (the stash is removed once you finish), or cancel to leave the stash and your changes as they were.",
    },
    bring: {
      title: `Your changes conflict with ${branch}`,
      intro: `You switched to ${branch} bringing your changes, and ${branch} changes the same lines in:`,
      outro: `Resolve the conflicts to keep your changes on ${branch}, or cancel to stay on ${branch} with no changes; yours are then kept as the stash of the branch you came from.`,
    },
  }[stashConflict];

  return (
    <ActionModal
      title={text.title}
      onDismiss={cancel}
      actions={[{ label: "Resolve conflicts", primary: true, onClick: dismissStashConflict }]}
    >
      <p>{text.intro}</p>
      <ul>
        {files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
      <p>{text.outro}</p>
    </ActionModal>
  );
}
