import "./RepoSwitcher.css";
import { useEffect, useRef, useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { baseName } from "../../utils/format";

/**
 * The repository name button in the header. Clicking it opens a dropdown of
 * recently opened repositories to switch to, each with a button to remove it
 * from the list, plus "Add new repo…" which shows the folder picker.
 */
export default function RepoSwitcher(): React.JSX.Element {
  const { repo, openRepository, openRepositoryAt } = useGitOperationsContext();
  const { recentRepos, forgetRepo } = useAppContext();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on a click outside the dropdown or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const switchTo = (path: string): void => {
    setOpen(false);
    if (path !== repo) void openRepositoryAt(path);
  };

  const addNew = (): void => {
    setOpen(false);
    void openRepository();
  };

  return (
    <div className="repo-switcher" ref={rootRef}>
      <button
        className="repo-switcher-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        title={repo ?? undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {repo && baseName(repo)} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="repo-switcher-menu popover" role="menu">
          {recentRepos.length === 0 ? (
            <p className="placeholder">No recent repositories</p>
          ) : (
            <ul>
              {recentRepos.map((path) => (
                <li key={path} className={path === repo ? "current" : undefined}>
                  <button
                    className="repo-switcher-item"
                    role="menuitem"
                    title={path}
                    onClick={() => switchTo(path)}
                  >
                    <span className="name">{baseName(path)}</span>
                    <span className="path">{path}</span>
                  </button>
                  <button
                    className="repo-switcher-forget"
                    title="Remove from list"
                    aria-label={`Remove ${baseName(path)} from list`}
                    onClick={() => forgetRepo(path)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="repo-switcher-add" role="menuitem" onClick={addNew}>
            + Add new repo…
          </button>
        </div>
      )}
    </div>
  );
}
