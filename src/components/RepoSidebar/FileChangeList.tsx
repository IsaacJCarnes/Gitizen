import type { ConflictFile, FileChange } from "../../../shared/gitTypes";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import { renamePaths } from "../../utils/format";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import FileListItem from "../common/FileListItem";
import TriStateCheckbox from "../common/TriStateCheckbox";
import ConflictBanner from "../Conflicts/ConflictBanner";
import MarkResolvedButton from "../Conflicts/MarkResolvedButton";
import { stashItem } from "../Stash/stashMenu";
import { combineStates, type CheckState } from "../../utils/checkState";

/**
 * One working-tree path. Git reports a partially staged file twice (once
 * for the index, once for the working tree), so both entries are kept.
 */
interface ChangedPath {
  path: string;
  /** Where a rename or copy came from. */
  oldPath?: string;
  staged?: FileChange;
  unstaged?: FileChange;
}

/**
 * Groups status entries by path, sorted by path. git lists untracked files
 * after tracked ones, so its own order would move a new file when staged.
 */
function groupByPath(files: FileChange[]): ChangedPath[] {
  const byPath = new Map<string, ChangedPath>();
  for (const file of files) {
    const entry = byPath.get(file.path) ?? { path: file.path };
    if (file.staged) entry.staged = file;
    else entry.unstaged = file;
    entry.oldPath ??= file.oldPath;
    byPath.set(file.path, entry);
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}


/**
 * One status code per file that doesn't change when the file is staged or
 * unstaged: a new file is "A" whether it is untracked ("?") or added, and a
 * deletion on either side wins over a modification.
 */
function displayCode(entry: ChangedPath): string {
  const codes = [entry.staged?.code, entry.unstaged?.code];
  if (codes.includes("A") || codes.includes("?")) return "A";
  if (codes.includes("D")) return "D";
  return entry.staged?.code ?? entry.unstaged?.code ?? "";
}

/** Checked when fully staged, mixed when only part of the file is staged. */
function stageState(entry: ChangedPath): CheckState {
  if (entry.staged && entry.unstaged) return "mixed";
  return Boolean(entry.staged);
}

/**
 * Working-tree files with uncommitted changes, in a single list. Each row's
 * checkbox stages or unstages the file; the header checkbox does every file
 * at once. Clicking a row opens its diff.
 *
 * While a merge (or similar) is stopped, a banner above the list says so,
 * and conflicted files show a "!" with a Mark resolved button instead of a
 * checkbox; clicking one opens it in the conflict editor.
 *
 * Right-clicking a file opens its menu, to discard its changes or add it
 * to the branch's stash; right-clicking the header stashes every change.
 */
export default function FileChangeList(): React.JSX.Element {
  const git = useGitOperationsContext();
  const {
    status,
    selectedFile,
    setSelectedFile,
    setFilesStaged,
    conflicts: { operation, files },
    selectedConflict,
    setSelectedConflict,
    discardFiles,
  } = git;
  const { view, setView } = useAppContext();
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  // A null target is the header's menu, for every file.
  const { menu, openMenu, closeMenu } = useContextMenu<ChangedPath | null>();
  const conflictByPath = new Map<string, ConflictFile>(
    files.map((file) => [file.path, file]),
  );
  const all = groupByPath(status?.files ?? []);
  // Staging a conflicted file would mark it resolved, so the checkboxes
  // (and "stage all") only cover the rest.
  const entries = all.filter((entry) => !conflictByPath.has(entry.path));
  const conflicted = all.filter((entry) => conflictByPath.has(entry.path));

  const states = entries.map(stageState);
  const fullyStaged = states.filter((state) => state === true).length;
  const allState = combineStates(states);

  const openConflict = (path: string): void => {
    setSelectedConflict(path);
    setView("conflict");
  };

  const open = (entry: ChangedPath): void => {
    // Either entry works: the diff covers staged and unstaged changes alike.
    setSelectedFile(entry.unstaged ?? entry.staged ?? null);
    setView("diff");
  };

  // A mixed checkbox stages the rest, like a select-all, rather than unstaging.
  // A rename moves in the index as a deletion plus an addition, so both
  // paths are staged or unstaged together.
  const toggle = (entry: ChangedPath) =>
    setFilesStaged(renamePaths(entry), stageState(entry) !== true);

  const toggleAll = () =>
    setFilesStaged(entries.flatMap(renamePaths), allState !== true);

  const menuEntries = (entry: ChangedPath | null): MenuEntry[] => {
    if (!entry) {
      const item = stashItem(git, [], "all changes");
      return [{ ...item, disabled: item.disabled || all.length === 0 }];
    }
    return [
      {
        label: "Discard changes…",
        title: "Put the file back as it was in the last commit",
        onSelect: () =>
          confirmDiscard({
            title: `Discard changes to ${entry.path}?`,
            what: (
              <>
                Every change to <code>{entry.path}</code>, staged or not,
              </>
            ),
            confirmLabel: "Discard changes",
            run: () => void discardFiles(renamePaths(entry)),
          }),
      },
      "separator",
      stashItem(git, renamePaths(entry), "file"),
    ];
  };

  return (
    <>
      <ConflictBanner />
      {/* The banner takes the header's place while an operation is stopped. */}
      {!operation && (
        <h2
          className="changes-header"
          onContextMenu={(event) => openMenu(event, null)}
        >
          <TriStateCheckbox
            state={allState}
            onChange={toggleAll}
            label={allState === true ? "Unstage all files" : "Stage all files"}
            disabled={entries.length === 0}
          />
          Changes ({all.length})<small>{fullyStaged} staged</small>
        </h2>
      )}
      <ul className="file-change-list">
        {conflicted.map((entry) => {
          const file = conflictByPath.get(entry.path)!;
          return (
            <FileListItem
              key={entry.path}
              path={entry.path}
              code="!"
              className="conflicted"
              title={
                file.hasMarkers
                  ? `${entry.path} (conflicted, open to resolve)`
                  : `${entry.path} (saved, ready to mark resolved)`
              }
              selected={view === "conflict" && selectedConflict === entry.path}
              onSelect={() => openConflict(entry.path)}
              leading={<span className="conflict-spacer" />}
              trailing={<MarkResolvedButton file={file} />}
            />
          );
        })}
        {entries.map((entry, index) => {
          const state = states[index];
          return (
            <FileListItem
              key={entry.path}
              path={entry.path}
              code={displayCode(entry)}
              title={
                state === "mixed"
                  ? `${entry.path} (partially staged)`
                  : entry.path
              }
              selected={selectedFile?.path === entry.path}
              onSelect={() => open(entry)}
              onContextMenu={(event) => openMenu(event, entry)}
              leading={
                <TriStateCheckbox
                  state={state}
                  onChange={() => toggle(entry)}
                  label={
                    state === true
                      ? `Unstage ${entry.path}`
                      : `Stage ${entry.path}`
                  }
                />
              }
            />
          );
        })}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menuEntries(menu.target)}
          onClose={closeMenu}
        />
      )}
      {discardDialog}
    </>
  );
}
