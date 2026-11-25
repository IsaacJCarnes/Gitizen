import { useState } from "react";
import type { GitCommit, ResetMode } from "../../../shared/gitTypes";
import { commitsAfter, RESET_MODES } from "../../utils/history";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { joinMessage, pluralize, shortHash } from "../../utils/format";
import ConfirmModal from "../common/ConfirmModal";
import FormModal from "../common/FormModal";

interface ResetDialogProps {
  commit: GitCommit;
  mode: ResetMode;
  onDismiss: () => void;
}

/** Confirms resetting the current branch to `commit`, saying what happens to the commits after it. */
export function ResetDialog({ commit, mode, onDismiss }: ResetDialogProps): React.JSX.Element {
  const { commits, rewritable, status, resetToCommit } = useGitOperationsContext();
  const dropped = commitsAfter(commits, commit.hash) ?? [];
  const lost = dropped.filter((each) => rewritable.includes(each.hash)).length;
  const kept = dropped.length - lost;
  const branch = status?.branch ?? "the branch";

  return (
    <ConfirmModal
      title={`Reset ${branch} to ${shortHash(commit.hash)} (${RESET_MODES[mode].label})?`}
      confirmLabel={`${RESET_MODES[mode].label} reset`}
      onConfirm={() => void resetToCommit(commit.hash, mode)}
      onDismiss={onDismiss}
    >
      <p>
        {branch} moves back to <code>{shortHash(commit.hash)}</code> {commit.message}, leaving out the{" "}
        {pluralize(dropped.length, "commit")} after it; {RESET_MODES[mode].keeps}.
      </p>
      {lost > 0 && (
        <p>
          {lost === dropped.length ? "They are" : `${lost} of them are`} on no other branch, tag or
          remote, so they won't be in the history any more (git's reflog keeps them for a while).
        </p>
      )}
      {kept > 0 && (
        <p>
          {pluralize(kept, "commit")} also on another branch, a tag or the remote stay there.
          {status?.upstream ? ` If ${status.upstream} has them, ${branch} will be behind it, and Pull brings them back.` : ""}
        </p>
      )}
      {mode === "hard" && (status?.files.length ?? 0) > 0 && (
        <p>
          <b>Your {pluralize(status?.files.length ?? 0, "uncommitted change")} will be thrown away too.</b>
        </p>
      )}
    </ConfirmModal>
  );
}

interface SquashDialogProps {
  /** The commits to squash, newest first. */
  commits: GitCommit[];
  onDismiss: () => void;
}

/**
 * Asks for the squashed commit's message, starting from the oldest
 * commit's subject with the others' subjects listed below it.
 */
export function SquashDialog({ commits, onDismiss }: SquashDialogProps): React.JSX.Element {
  const { squashCommits } = useGitOperationsContext();
  const oldestFirst = [...commits].reverse();
  const [summary, setSummary] = useState(oldestFirst[0]?.message ?? "");
  const [description, setDescription] = useState(
    oldestFirst
      .slice(1)
      .map((commit) => `- ${commit.message}`)
      .join("\n"),
  );

  return (
    <FormModal
      title={`Squash ${pluralize(commits.length, "commit")}`}
      submitLabel="Squash"
      workingLabel="Squashing…"
      ready={summary.trim() !== ""}
      onSubmit={() =>
        squashCommits(
          commits.map((commit) => commit.hash),
          joinMessage(summary, description),
        )
      }
      onDismiss={onDismiss}
      className="modal-form"
    >
      <p className="hint">
        {pluralize(commits.length, "commit")} become one, with all of their changes. Commits after
        them are replayed on top.
      </p>
      <label>
        Summary
        <input value={summary} autoFocus onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label>
        Description
        <textarea
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
    </FormModal>
  );
}

interface DeleteTagDialogProps {
  tag: string;
  onDismiss: () => void;
}

/** Confirms deleting a tag, optionally from the remote too. */
export function DeleteTagDialog({ tag, onDismiss }: DeleteTagDialogProps): React.JSX.Element {
  const { deleteTag, remotes } = useGitOperationsContext();
  const remote = remotes.find((each) => each.name === "origin") ?? (remotes.length === 1 ? remotes[0] : undefined);
  const [fromRemote, setFromRemote] = useState(false);

  return (
    <ConfirmModal
      title={`Delete tag ${tag}?`}
      confirmLabel="Delete tag"
      onConfirm={() => void deleteTag(tag, fromRemote)}
      onDismiss={onDismiss}
    >
      <p>The tag is removed; the commit it points at stays.</p>
      {remote && (
        <label className="modal-check">
          <input
            type="checkbox"
            checked={fromRemote}
            onChange={(event) => setFromRemote(event.target.checked)}
          />
          Also delete it from {remote.name}, for everyone
        </label>
      )}
    </ConfirmModal>
  );
}
