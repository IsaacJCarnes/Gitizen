import "./FileDiff.css";
import { useEffect, useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useDiffSettings } from "../../hooks/useDiffSettings";
import { gitizen } from "../../api/gitizen";
import { pluralize, shortHash } from "../../utils/format";
import { loadOrReset } from "../../utils/load";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import DiffView, { type LineStaging } from "../common/DiffView";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import FileEditor from "./FileEditor";

/**
 * Diff of the file picked in the sidebar, with a header naming the file and
 * where the change lives (a commit's short hash, or Uncommitted), the diff
 * settings, and a button back to the history.
 *
 * Working-tree diffs show every uncommitted change with a checkbox on each
 * changed line, ticked when that line is staged: tick to stage, untick to
 * unstage. The diff itself stays the same either way. Right-clicking a
 * changed line offers to discard it, or its whole group of changes.
 *
 * A text file that is in the working directory can be edited in place:
 * "Edit" for the working tree's or the last commit's file, "Edit in working
 * directory" for an older commit's, since it is the current file that changes.
 */
export default function FileDiff(): React.JSX.Element {
  const { setView } = useAppContext();
  const {
    selectedCommit,
    selectedCommitFile,
    commitDiff,
    selectedFile,
    diff,
    stagedLines,
    stageLines,
    discardLines,
    status,
    reportError,
    branchStash,
    selectedStashFile,
    stashDiff,
  } = useGitOperationsContext();
  const { settings, updateSettings } = useDiffSettings();
  const [applying, setApplying] = useState(false);
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  // A changed line's menu: the line, and its group of changed lines.
  const { menu: lineMenu, openMenu, closeMenu } = useContextMenu<{ line: number; group: number[] }>();

  // A stash file picked in the sidebar is shown read-only, like a commit's.
  const stashFile = !selectedCommit && branchStash ? selectedStashFile : null;
  const path = selectedCommit ? selectedCommitFile?.path : (stashFile?.path ?? selectedFile?.path);
  const shownDiff = selectedCommit ? commitDiff : stashFile ? stashDiff : diff;
  const source = selectedCommit ? shortHash(selectedCommit.hash) : stashFile ? "Stash" : "Uncommitted";
  // The commit (or stash) whose copy of the file is shown, if not the working tree's.
  const shownHash = selectedCommit?.hash ?? (stashFile ? branchStash?.hash : undefined);

  // Whether the file can be edited: a text file in the working directory.
  // Checked again after every refresh, since the file may come or go.
  const [editable, setEditable] = useState(false);
  const [editing, setEditing] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => loadOrReset(path ? gitizen.canEditFile(path) : null, setEditable, false), [path, status]);
  // Picking another file (or commit) leaves the editor without saving.
  useEffect(() => setEditing(null), [path, selectedCommit, stashFile]);
  const editingPath = editing?.path === path ? editing : null;
  // An older commit's file is edited as it is now, in the working directory.
  const atHead = stashFile
    ? false
    : !selectedCommit || selectedCommit.refs.some((ref) => ref.current);

  const startEditing = (): void => {
    if (!path) return;
    gitizen.workingFile(path).then((text) => setEditing({ path, text }), reportError);
  };

  // Lines are staged by rewriting the index from the diff as shown, so this
  // needs the full diff, not one with whitespace changes hidden.
  let lineStaging: LineStaging | undefined;
  if (!shownHash && selectedFile && !settings.hideWhitespace) {
    lineStaging = {
      staged: new Set(stagedLines),
      disabled: applying,
      onToggle: (lines, staged) => {
        setApplying(true);
        void stageLines(lines, staged).finally(() => setApplying(false));
      },
    };
  }

  /** Asks, then throws away `lines` of the working-tree file. */
  const discard = (lines: number[]): void => {
    const count = lines.length;
    confirmDiscard({
      title: count === 1 ? "Discard this line?" : `Discard ${count} lines?`,
      what: (
        <>
          {count === 1 ? "The change on this line" : `The changes on ${count} lines`} of{" "}
          <code>{path}</code>
        </>
      ),
      confirmLabel: count === 1 ? "Discard line" : "Discard lines",
      run: () => {
        setApplying(true);
        void discardLines(lines).finally(() => setApplying(false));
      },
    });
  };

  const lineMenuEntries = (line: number, group: number[]): MenuEntry[] => {
    // Discarding maps the lines back onto the file, like staging them.
    const disabled = settings.hideWhitespace || applying;
    const title = settings.hideWhitespace ? "Show whitespace to discard single lines" : undefined;
    const entries: MenuEntry[] = [
      { label: "Discard this line…", disabled, title, onSelect: () => discard([line]) },
    ];
    if (group.length > 1) {
      entries.push({
        label: `Discard these ${pluralize(group.length, "line")}…`,
        disabled,
        title: title ?? "Every changed line of this block",
        onSelect: () => discard(group),
      });
    }
    return entries;
  };

  return (
    <div className="file-diff">
      <header className="diff-header">
        <button onClick={() => setView("history")}>← History</button>
        <span className="path" title={path}>
          {path}
        </span>
        <small>{editingPath ? "Working directory" : source}</small>
        {path && editable && !editingPath && (
          <button
            title={
              atHead
                ? "Edit this file"
                : "Edit the file as it is now in the working directory, not as it was in this commit"
            }
            onClick={startEditing}
          >
            {atHead ? "Edit" : "Edit in working directory"}
          </button>
        )}
        <span className="diff-settings" style={editingPath ? { display: "none" } : undefined}>
          <span className="button-group" role="group" aria-label="Diff layout">
            {(["unified", "split"] as const).map((layout) => (
              <button
                key={layout}
                className={settings.layout === layout ? "active" : ""}
                aria-pressed={settings.layout === layout}
                title={layout === "split" ? "Removed lines beside added lines" : "One column"}
                onClick={() => updateSettings({ layout })}
              >
                {layout === "split" ? "Split" : "Unified"}
              </button>
            ))}
          </span>
          <label
            title={
              !selectedCommit && settings.hideWhitespace
                ? "Show whitespace to stage single lines"
                : "Hide changes that only touch whitespace"
            }
          >
            <input
              type="checkbox"
              checked={settings.hideWhitespace}
              onChange={(event) => updateSettings({ hideWhitespace: event.target.checked })}
            />
            Hide whitespace
          </label>
        </span>
      </header>
      {path && editingPath ? (
        <FileEditor
          key={path}
          path={path}
          initialText={editingPath.text}
          onDone={() => setEditing(null)}
        />
      ) : path ? (
        <DiffView
          diff={shownDiff}
          layout={settings.layout}
          lineStaging={lineStaging}
          loadFile={() => gitizen.fileText(path, shownHash)}
          onLineMenu={
            shownHash
              ? undefined
              : (event, line, group) => openMenu(event, { line, group })
          }
          emptyMessage={
            settings.hideWhitespace ? "No changes besides whitespace." : "No changes to show."
          }
        />
      ) : (
        <p className="placeholder">Select a file in the sidebar.</p>
      )}
      {lineMenu && (
        <ContextMenu
          x={lineMenu.x}
          y={lineMenu.y}
          entries={lineMenuEntries(lineMenu.target.line, lineMenu.target.group)}
          onClose={closeMenu}
        />
      )}
      {discardDialog}
    </div>
  );
}
