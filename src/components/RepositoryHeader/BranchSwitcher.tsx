import "./BranchSwitcher.css";
import { useEffect, useRef, useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useBranchMenu } from "../Branches/useBranchMenu";

/** Runs `after` too whenever one of `entries` (or a submenu entry) is chosen. */
function alsoOnSelect(entries: MenuEntry[], after: () => void): MenuEntry[] {
  return entries.map((entry) =>
    entry === "separator"
      ? entry
      : {
          ...entry,
          onSelect: entry.onSelect && (() => {
            after();
            entry.onSelect?.();
          }),
          submenu: entry.submenu && alsoOnSelect(entry.submenu, after),
        },
  );
}

/**
 * The branch button in the header. It opens a list of local branches with a
 * search box that filters them as you type; clicking a branch (or Enter on
 * the first match) checks it out, and right-clicking one opens its menu
 * (rename and delete; merging lives in the history graph).
 */
export default function BranchSwitcher(): React.JSX.Element {
  const { status, branches, checkoutBranch } = useGitOperationsContext();
  const { branchEntries, branchDialog } = useBranchMenu();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // A branch's menu, for the branch name.
  const { menu, openMenu, closeMenu } = useContextMenu<string>();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on a click outside the dropdown (or its menu) or on Escape.
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

  // A new repository's branch has no commits yet, so it isn't listed in
  // `branches`; show it anyway so the label isn't blank.
  const current = status?.branch ?? null;
  const unborn = current !== null && !branches.some((branch) => branch.name === current);
  const needle = query.trim().toLowerCase();
  const matches = branches.filter((branch) => branch.name.toLowerCase().includes(needle));

  const toggle = (): void => {
    setQuery("");
    setOpen((wasOpen) => !wasOpen);
  };

  const choose = (name: string): void => {
    setOpen(false);
    if (name !== current) void checkoutBranch(name);
  };

  return (
    <div className="branch-switcher" ref={rootRef}>
      <button
        className="branch-switcher-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch branch"
        onClick={toggle}
      >
        {current ?? "Detached HEAD"} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="branch-switcher-menu popover">
          <input
            type="search"
            className="branch-switcher-search"
            placeholder="Filter branches"
            aria-label="Filter branches"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches[0]) choose(matches[0].name);
            }}
          />
          <ul role="listbox" aria-label="Branches">
            {unborn && !needle && (
              <li className="current" title="No commits yet">
                <span className="name">{current}</span>
              </li>
            )}
            {matches.map((branch) => (
              <li
                key={branch.name}
                role="option"
                aria-selected={branch.current}
                className={branch.current ? "current" : undefined}
              >
                <button
                  title={branch.current ? `${branch.name} (checked out)` : `Check out ${branch.name}`}
                  onClick={() => choose(branch.name)}
                  onContextMenu={(event) => openMenu(event, branch.name)}
                >
                  <span className="name">{branch.name}</span>
                  {!branch.current && (branch.ahead > 0 || branch.behind > 0) && (
                    <small title={`${branch.ahead} ahead of and ${branch.behind} behind ${current ?? "HEAD"}`}>
                      {branch.ahead > 0 && `↑${branch.ahead}`} {branch.behind > 0 && `↓${branch.behind}`}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {matches.length === 0 && needle && <p className="placeholder">No branches match “{query.trim()}”</p>}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={alsoOnSelect(branchEntries(menu.target, false), () => setOpen(false))}
          onClose={closeMenu}
        />
      )}
      {branchDialog}
    </div>
  );
}
