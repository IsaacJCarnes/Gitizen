import "./CloneModal.css";
import { useEffect, useMemo, useState } from "react";
import type { GitHubRepository } from "../../../shared/gitTypes";
import { gitizen } from "../../api/gitizen";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { cloneFolderName, parentFolder } from "../../utils/github";
import FormModal from "../common/FormModal";
import SignInModal from "../GitHub/SignInModal";

type Source = "github" | "url";

/** localStorage key of the folder the last clone went into, offered again next time. */
const FOLDER_KEY = "gitizen.cloneFolder";

/** The folder the last clone went into, if the webview kept it. */
function savedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

interface CloneModalProps {
  onDismiss: () => void;
}

/**
 * Clones a repository, picked from the signed-in GitHub account's
 * repositories or given by URL, into a new folder, then opens it.
 */
export default function CloneModal({ onDismiss }: CloneModalProps): React.JSX.Element {
  const { cloneRepository, reportError } = useGitOperationsContext();
  const { github, recentRepos } = useAppContext();
  const [source, setSource] = useState<Source>("github");
  const [signingIn, setSigningIn] = useState(false);
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<GitHubRepository | null>(null);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(() => savedFolder() ?? parentFolder(recentRepos[0] ?? ""));
  // The folder name follows the chosen repository until it is typed in.
  const [typedName, setTypedName] = useState<string | null>(null);

  const account = github.account;
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setRepositories(null);
    gitizen
      .gitHubRepositories()
      .then((listed) => !cancelled && setRepositories(listed))
      .catch((caught) => {
        if (cancelled) return;
        setRepositories([]);
        reportError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [account, reportError]);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (repositories ?? []).filter((repository) =>
      repository.fullName.toLowerCase().includes(needle),
    );
  }, [repositories, filter]);

  if (signingIn) return <SignInModal onDismiss={() => setSigningIn(false)} />;

  const cloneUrl = source === "github" ? (picked?.cloneUrl ?? "") : url.trim();
  const name = typedName ?? (source === "github" ? (picked?.name ?? "") : cloneFolderName(url));
  const separator = parent.includes("\\") ? "\\" : "/";

  const browse = async (): Promise<void> => {
    try {
      const folder = await gitizen.chooseFolder();
      if (folder) setParent(folder);
    } catch (caught) {
      reportError(caught);
    }
  };

  const clone = async (): Promise<boolean> => {
    const ok = await cloneRepository(cloneUrl, parent, name);
    if (ok) {
      try {
        localStorage.setItem(FOLDER_KEY, parent);
      } catch {
        // Only a convenience for next time.
      }
    }
    return ok;
  };

  return (
    <FormModal
      title="Clone a repository"
      submitLabel="Clone"
      workingLabel="Cloning…"
      ready={cloneUrl !== "" && parent.trim() !== "" && name.trim() !== ""}
      onSubmit={clone}
      onDismiss={onDismiss}
      className="modal-form clone-form"
    >
      <span className="button-group" role="tablist">
        {(["github", "url"] as const).map((each) => (
          <button
            key={each}
            type="button"
            role="tab"
            aria-selected={source === each}
            className={source === each ? "active" : undefined}
            onClick={() => {
              setSource(each);
              setTypedName(null);
            }}
          >
            {each === "github" ? "GitHub" : "URL"}
          </button>
        ))}
      </span>

      {source === "url" ? (
        <label>
          Repository URL
          <input
            value={url}
            autoFocus
            placeholder="https://github.com/owner/repo.git"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      ) : !account ? (
        <p className="hint">
          Sign in to GitHub to pick from your repositories.{" "}
          <button type="button" onClick={() => setSigningIn(true)}>
            Sign in to GitHub
          </button>
        </p>
      ) : (
        <div className="clone-picker">
          <input
            value={filter}
            autoFocus
            placeholder={`Filter ${account.login}'s repositories`}
            aria-label="Filter repositories"
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul className="clone-list" role="listbox" aria-label="Your GitHub repositories">
            {repositories === null ? (
              <li className="placeholder">Loading your repositories…</li>
            ) : matches.length === 0 ? (
              <li className="placeholder">No repositories match.</li>
            ) : (
              matches.map((repository) => (
                <li
                  key={repository.fullName}
                  role="option"
                  aria-selected={picked?.fullName === repository.fullName}
                  className={picked?.fullName === repository.fullName ? "on" : undefined}
                  title={repository.description ?? repository.fullName}
                  onClick={() => {
                    setPicked(repository);
                    setTypedName(null);
                  }}
                >
                  <span className="clone-name">
                    {repository.fullName}
                    {repository.private && <small> private</small>}
                  </span>
                  {repository.description && (
                    <span className="clone-description">{repository.description}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <label>
        Clone into
        <span className="clone-folder">
          <input
            value={parent}
            placeholder="Choose a folder"
            onChange={(event) => setParent(event.target.value)}
          />
          <button type="button" onClick={() => void browse()}>
            Browse…
          </button>
        </span>
      </label>
      <label>
        Folder name
        <input value={name} onChange={(event) => setTypedName(event.target.value)} />
      </label>
      {parent.trim() && name.trim() && (
        <p className="hint">
          Clones to <code>{`${parent.trim().replace(/[\\/]+$/, "")}${separator}${name.trim()}`}</code>
        </p>
      )}
    </FormModal>
  );
}
