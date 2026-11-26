import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";
import FormModal from "../common/FormModal";
import { useSignInPrompt } from "../GitHub/useSignInPrompt";
import { publishWarning } from "./publishTarget";

type Mode = "github" | "existing";

interface PublishModalProps {
  /** Which option starts selected: creating on GitHub, or connecting an existing remote. */
  initialMode?: Mode;
  onDismiss: () => void;
}

/**
 * Puts a repository that has no remote online: either creates it on the
 * signed-in GitHub account (and pushes the current branch there), or adds an
 * existing repository's URL as a remote so the branch can be pushed there.
 * Creating it from a branch other than main warns first, since that branch
 * becomes the new repository's default branch.
 */
export default function PublishModal({
  initialMode = "github",
  onDismiss,
}: PublishModalProps): React.JSX.Element {
  const { repo, status, branches, commits, addRemote, publishRepository } = useGitOperationsContext();
  const { account } = useAppContext().github;
  const { signInModal, prompt } = useSignInPrompt();
  const [mode, setMode] = useState<Mode>(initialMode);
  // Publishing pushes the current branch; on another branch than main, warn.
  const trunk = publishWarning(status?.branch, branches, null, commits);
  const [name, setName] = useState(baseName(repo ?? "") ?? "");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [remoteName, setRemoteName] = useState("origin");
  const [url, setUrl] = useState("");
  const github = mode === "github";

  if (signInModal) return signInModal;

  return (
    <FormModal
      title="Publish repository"
      submitLabel={github ? "Publish" : "Add remote"}
      workingLabel="Working…"
      ready={github ? account !== null && name.trim() !== "" : remoteName.trim() !== "" && url.trim() !== ""}
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
          {account ? (
            <p className="hint">
              Creates the repository on <b>{account.login}</b>. It becomes <code>origin</code> and
              the current branch is pushed to it.
            </p>
          ) : (
            prompt("Sign in to GitHub to create the repository there.")
          )}
          {trunk && (
            <p className="hint publish-warning">
              &#9888; You are on <code>{status?.branch}</code>, not <code>{trunk}</code>. Only{" "}
              {status?.branch} is pushed, and it becomes the repository&apos;s default branch on
              GitHub. Check out {trunk} first to publish that instead.
            </p>
          )}
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
