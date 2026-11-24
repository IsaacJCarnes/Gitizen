import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";
import FormModal from "../common/FormModal";

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
  const github = mode === "github";

  return (
    <FormModal
      title="Publish repository"
      submitLabel={github ? "Publish" : "Add remote"}
      workingLabel="Working…"
      ready={github ? name.trim() !== "" : remoteName.trim() !== "" && url.trim() !== ""}
      onSubmit={() =>
        github ? publishRepository(name, description, isPrivate) : addRemote(remoteName, url)
      }
      onDismiss={onDismiss}
      className="modal-form"
    >
      <div className="modal-form-choices" role="radiogroup">
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
      {github ? (
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
    </FormModal>
  );
}
