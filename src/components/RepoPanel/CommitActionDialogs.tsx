import "./CommitActionDialogs.css";
import { useState } from "react";
import type { GitCommit } from "../../../shared/gitTypes";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { shortHash } from "../../utils/format";
import ActionModal from "../common/ActionModal";

interface DialogProps {
  commit: GitCommit;
  onDismiss: () => void;
}

/** "abc1234 Fix the thing", naming the commit a dialog acts on. */
function CommitLine({ commit }: { commit: GitCommit }): React.JSX.Element {
  return (
    <p className="commit-dialog-target">
      <code>{shortHash(commit.hash)}</code> {commit.message}
    </p>
  );
}

/**
 * Runs `action` once, shows "Working…" meanwhile, and closes the dialog only
 * if it worked (on failure the error modal explains, and the dialog stays
 * open to try again).
 */
function useSubmit(action: () => Promise<boolean>, onDismiss: () => void) {
  const [working, setWorking] = useState(false);
  const submit = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    const ok = await action();
    setWorking(false);
    if (ok) onDismiss();
  };
  return { working, submit };
}

/** Asks for a branch name and creates it at the commit. */
export function CreateBranchDialog({
  commit,
  onDismiss,
}: DialogProps): React.JSX.Element {
  const { createBranch } = useGitOperationsContext();
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const ready = name.trim() !== "";
  const { working, submit } = useSubmit(
    () => createBranch(name, commit.hash, checkout),
    onDismiss,
  );

  return (
    <ActionModal
      title="Create branch"
      onDismiss={onDismiss}
      actions={[
        {
          label: working ? "Creating…" : "Create branch",
          primary: true,
          disabled: !ready || working,
          onClick: () => void submit(),
        },
      ]}
    >
      <form
        className="commit-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void submit();
        }}
      >
        <CommitLine commit={commit} />
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder="feature/my-change"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={checkout}
            onChange={(event) => setCheckout(event.target.checked)}
          />
          Switch to the new branch
        </label>
        <button type="submit" hidden />
      </form>
    </ActionModal>
  );
}

/** Asks for a tag name (and optional message) and tags the commit. */
export function CreateTagDialog({
  commit,
  onDismiss,
}: DialogProps): React.JSX.Element {
  const { createTag } = useGitOperationsContext();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const ready = name.trim() !== "";
  const { working, submit } = useSubmit(
    () => createTag(name, commit.hash, message),
    onDismiss,
  );

  return (
    <ActionModal
      title="Create tag"
      onDismiss={onDismiss}
      actions={[
        {
          label: working ? "Creating…" : "Create tag",
          primary: true,
          disabled: !ready || working,
          onClick: () => void submit(),
        },
      ]}
    >
      <form
        className="commit-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void submit();
        }}
      >
        <CommitLine commit={commit} />
        <label>
          Name
          <input
            value={name}
            autoFocus
            placeholder="v1.0.0"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Message (optional)
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <p className="hint">
          The tag is pushed along with its branch the next time you push.
        </p>
        <button type="submit" hidden />
      </form>
    </ActionModal>
  );
}

/** Picks a local branch and cherry-picks the commit onto it. */
export function CherryPickDialog({
  commit,
  onDismiss,
}: DialogProps): React.JSX.Element {
  const { branches, cherryPick } = useGitOperationsContext();
  // Usually the point is another branch, so that is the default.
  const [branch, setBranch] = useState(
    () =>
      (branches.find((candidate) => !candidate.current) ?? branches[0])?.name ??
      "",
  );
  const switching = branches.some(
    (candidate) => candidate.name === branch && !candidate.current,
  );
  const { working, submit } = useSubmit(
    () => cherryPick(commit.hash, branch),
    onDismiss,
  );

  return (
    <ActionModal
      title="Cherry-pick commit"
      onDismiss={onDismiss}
      actions={[
        {
          label: working ? "Cherry-picking…" : "Cherry-pick",
          primary: true,
          disabled: branch === "" || working,
          onClick: () => void submit(),
        },
      ]}
    >
      <div className="commit-dialog">
        <CommitLine commit={commit} />
        <label>
          Onto branch
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            {branches.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
                {candidate.current ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          {switching
            ? `Gitizen switches to ${branch} and adds a copy of this commit there. Commit or stash your changes first. `
            : "A copy of this commit is added on top of the current branch. "}
          If it conflicts, you can resolve or abort it.
        </p>
      </div>
    </ActionModal>
  );
}
