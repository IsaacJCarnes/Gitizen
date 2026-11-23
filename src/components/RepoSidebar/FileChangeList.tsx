import type { ConflictFile, FileChange } from "../../../shared/gitTypes";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import FileListItem from "../common/FileListItem";
import TriStateCheckbox from "../common/TriStateCheckbox";
import ConflictBanner from "../Conflicts/ConflictBanner";
import MarkResolvedButton from "../Conflicts/MarkResolvedButton";
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
 * The paths git must be given to stage or unstage the entry. A rename lives
 * in the index as a deletion of the old path plus an addition of the new
 * one, so both halves have to move together.
 */
function pathsOf(entry: ChangedPath): string[] {
  return entry.oldPath ? [entry.path, entry.oldPath] : [entry.path];
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
 */
export default function FileChangeList(): React.JSX.Element {
  const {
    status,
    selectedFile,
    setSelectedFile,
    setFilesStaged,
    conflicts: { operation, files },
    selectedConflict,
    setSelectedConflict,
  } = useGitOperationsContext();
  const { view, setView } = useAppContext();
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
  const toggle = (entry: ChangedPath) =>
    setFilesStaged(pathsOf(entry), stageState(entry) !== true);

  const toggleAll = () =>
    setFilesStaged(entries.flatMap(pathsOf), allState !== true);

  return (
    <>
      <ConflictBanner />
      {/* The banner takes the header's place while an operation is stopped. */}
      {!operation && (
        <h2 className="changes-header">
          <TriStateCheckbox
            state={allState}
            onChange={toggleAll}
            label={allState === true ? "Unstage all files" : "Stage all files"}
            disabled={entries.length === 0}
          />
          Changes ({all.length})
          <small>{fullyStaged} staged</small>
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
              title={state === "mixed" ? `${entry.path} (partially staged)` : entry.path}
              selected={selectedFile?.path === entry.path}
              onSelect={() => open(entry)}
              leading={
                <TriStateCheckbox
                  state={state}
                  onChange={() => toggle(entry)}
                  label={state === true ? `Unstage ${entry.path}` : `Stage ${entry.path}`}
                />
              }
            />
          );
        })}
      </ul>
    </>
  );
}
