import "../RepoPanel/CommitActionDialogs.css";
import { useState } from "react";
import type { GitBranch } from "../../../shared/gitTypes";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { pluralize } from "../../utils/format";
import FormModal from "../common/FormModal";
import { useMessageFields } from "../common/MessageFields";

interface BranchDialogProps {
  branch: GitBranch;
  onDismiss: () => void;
}

/** Asks for a new name for the branch. */
export function RenameBranchDialog({ branch, onDismiss }: BranchDialogProps): React.JSX.Element {
  const { renameBranch } = useGitOperationsContext();
  const [name, setName] = useState(branch.name);
  const trimmed = name.trim();

  return (
    <FormModal
      title={`Rename ${branch.name}`}
      submitLabel="Rename branch"
      workingLabel="Renaming…"
      ready={trimmed !== "" && trimmed !== branch.name}
      onSubmit={() => renameBranch(branch.name, trimmed)}
      onDismiss={onDismiss}
      className="modal-form"
    >
      <label>
        New name
        <input
          value={name}
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="hint">
        Only the local branch is renamed. A copy already pushed keeps its old name on the remote.
      </p>
    </FormModal>
  );
}

/**
 * Confirms deleting the branch. A branch with commits the checked-out one
 * doesn't have says so, and is deleted anyway (forced) once confirmed.
 */
export function DeleteBranchDialog({ branch, onDismiss }: BranchDialogProps): React.JSX.Element {
  const { deleteBranch, status } = useGitOperationsContext();
  const unmerged = branch.ahead > 0;

  return (
    <FormModal
      title={`Delete ${branch.name}?`}
      submitLabel="Delete branch"
      workingLabel="Deleting…"
      ready
      onSubmit={() => deleteBranch(branch.name, unmerged)}
      onDismiss={onDismiss}
    >
      <p>
        The local branch <code>{branch.name}</code> will be deleted. A copy already pushed stays on
        the remote.
      </p>
      {unmerged && (
        <p>
          <b>
            It has {pluralize(branch.ahead, "commit")} that {status?.branch ?? "the current commit"}{" "}
            doesn&apos;t.
          </b>{" "}
          Unless they are pushed or on another branch, they will be lost.
        </p>
      )}
    </FormModal>
  );
}

/** Asks for the message of the single commit a squash merge makes. */
export function SquashMergeDialog({ branch, onDismiss }: BranchDialogProps): React.JSX.Element {
  const { squashMergeBranch, status } = useGitOperationsContext();
  const { fields, message, ready } = useMessageFields(`Squash merge branch '${branch.name}'`);
  const current = status?.branch ?? "the current branch";

  return (
    <FormModal
      title={`Squash and merge ${branch.name}`}
      submitLabel="Squash and merge"
      workingLabel="Merging…"
      ready={ready}
      onSubmit={() => squashMergeBranch(branch.name, message)}
      onDismiss={onDismiss}
      className="modal-form"
    >
      <p className="hint">
        {branch.name}&apos;s {pluralize(branch.ahead, "commit")} will be combined into one new commit
        on {current}. {branch.name} itself stays as it is. If they conflict, you resolve the conflicts and then
        commit.
      </p>
      {fields}
    </FormModal>
  );
}
