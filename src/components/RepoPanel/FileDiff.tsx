import "./FileDiff.css";
import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useDiffSettings } from "../../hooks/useDiffSettings";
import { gitizen } from "../../api/gitizen";
import { pluralize, shortHash } from "../../utils/format";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import DiffView, { type LineStaging } from "../common/DiffView";
import { useDiscardConfirmation } from "../common/DiscardConfirm";

/**
 * Diff of the file picked in the sidebar, with a header naming the file and
 * where the change lives (a commit's short hash, or Uncommitted), the diff
 * settings, and a button back to the history.
 *
 * Working-tree diffs show every uncommitted change with a checkbox on each
 * changed line, ticked when that line is staged: tick to stage, untick to
 * unstage. The diff itself stays the same either way. Right-clicking a
 * changed line offers to discard it, or its whole group of changes.
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
  } = useGitOperationsContext();
  const { settings, updateSettings } = useDiffSettings();
  const [applying, setApplying] = useState(false);
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; line: number; group: number[] } | null>(null);

  const path = selectedCommit ? selectedCommitFile?.path : selectedFile?.path;
  const shownDiff = selectedCommit ? commitDiff : diff;
  const source = selectedCommit ? shortHash(selectedCommit.hash) : "Uncommitted";

  // Lines are staged by rewriting the index from the diff as shown, so this
  // needs the full diff, not one with whitespace changes hidden.
  let lineStaging: LineStaging | undefined;
  if (!selectedCommit && selectedFile && !settings.hideWhitespace) {
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
        <small>{source}</small>
        <span className="diff-settings">
          <span className="segmented" role="group" aria-label="Diff layout">
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
      {path ? (
        <DiffView
          diff={shownDiff}
          layout={settings.layout}
          lineStaging={lineStaging}
          loadFile={() => gitizen.fileText(path, selectedCommit?.hash)}
          onLineMenu={
            selectedCommit
              ? undefined
              : (event, line, group) => setLineMenu({ x: event.clientX, y: event.clientY, line, group })
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
          entries={lineMenuEntries(lineMenu.line, lineMenu.group)}
          onClose={() => setLineMenu(null)}
        />
      )}
      {discardDialog}
    </div>
  );
}
