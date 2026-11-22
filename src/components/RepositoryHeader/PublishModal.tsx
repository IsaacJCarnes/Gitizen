import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";
import ActionModal from "../common/ActionModal";

type Mode = "github" | "existing";

interface PublishModalProps {
  onDismiss: () => void;
}

/**
 * Puts a repository that has no remote online: either creates it on GitHub
 * (through the GitHub CLI, which pushes the current branch too), or adds an
 * existing repository's URL as a remote so the branch can be pushed there.
 */
export default function PublishModal({ onDismiss }: PublishModalProps): React.JSX.Element {
  const { repo, addRemote, publishRepository } = useGitOperationsContext();
  const [mode, setMode] = useState<Mode>("github");
  const [name, setName] = useState(baseName(repo ?? "") ?? "");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [remoteName, setRemoteName] = useState("origin");
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);

  const ready = mode === "github" ? name.trim() !== "" : remoteName.trim() !== "" && url.trim() !== "";

  const submit = async (): Promise<void> => {
    if (!ready || working) return;
    setWorking(true);
    const ok =
      mode === "github"
        ? await publishRepository(name, description, isPrivate)
        : await addRemote(remoteName, url);
    setWorking(false);
    // On failure the error modal explains why; keep this open to retry.
    if (ok) onDismiss();
  };

  return (
    <ActionModal
      title="Publish repository"
      onDismiss={onDismiss}
      actions={[
        {
          label: working ? "Working…" : mode === "github" ? "Publish" : "Add remote",
          primary: true,
          disabled: !ready || working,
          onClick: () => void submit(),
        },
      ]}
    >
      <form
        className="publish-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="publish-modes" role="radiogroup">
          <label className="inline">
            <input
              type="radio"
              checked={mode === "github"}
              onChange={() => setMode("github")}
            />
            Create on GitHub
          </label>
          <label className="inline">
            <input
              type="radio"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />
            Add an existing remote
          </label>
        </div>
        {mode === "github" ? (
          <>
            <label>
              Name
              <input value={name} autoFocus onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Description (optional)
              <input value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              Keep this repository private
            </label>
            <p className="hint">
              Uses the GitHub CLI (<code>gh</code>), signed in with <code>gh auth login</code>. The
              new repository becomes <code>origin</code> and the current branch is pushed to it.
            </p>
          </>
        ) : (
          <>
            <label>
              Remote name
              <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} />
            </label>
            <label>
              URL
              <input
                value={url}
                autoFocus
                placeholder="https://github.com/owner/repo.git"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <p className="hint">Then use Publish branch to push the current branch there.</p>
          </>
        )}
        {/* Lets Enter in any field submit the form. */}
        <button type="submit" hidden />
      </form>
    </ActionModal>
  );
}
