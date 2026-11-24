import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ActionModal from "../common/ActionModal";
import { pluralize } from "../../utils/format";

/**
 * Asks what to do with uncommitted changes before switching branches:
 * leave them on the current branch (in its stash, to pop when coming back)
 * or bring them along to the other branch. Shown while `pendingSwitch` is set.
 */
export default function SwitchBranchModal(): React.JSX.Element | null {
  const { pendingSwitch, answerSwitch, status, branchStash } = useGitOperationsContext();
  if (!pendingSwitch) return null;
  const current = status?.branch ?? null;
  const count = status?.files.length ?? 0;

  return (
    <ActionModal
      title={`Switch to ${pendingSwitch}`}
      onDismiss={() => void answerSwitch(null)}
      actions={[
        {
          label: `Bring to ${pendingSwitch}`,
          onClick: () => void answerSwitch("bring"),
        },
        {
          label: current ? `Leave on ${current}` : "Leave them",
          primary: true,
          // Only a branch keeps a stash; a detached HEAD has nowhere to leave them.
          disabled: current === null,
          onClick: () => void answerSwitch("leave"),
        },
      ]}
    >
      <p>
        You have {pluralize(count, "uncommitted change")}
        {current ? ` on ${current}` : ""}. What should happen to {count === 1 ? "it" : "them"}?
      </p>
      <p className="hint">
        {current
          ? `Leaving them stashes them on ${current}${
              branchStash ? ", added to the stash it already has" : ""
            }; pop the stash when you come back. Bringing them carries them over; if ${pendingSwitch} changes the same lines, you resolve the conflicts there.`
          : "HEAD is detached, so the changes can only come along."}
      </p>
    </ActionModal>
  );
}
