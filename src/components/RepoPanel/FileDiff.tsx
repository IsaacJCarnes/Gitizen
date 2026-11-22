import "./FileDiff.css";
import { useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { useDiffSettings } from "../../hooks/useDiffSettings";
import { gitizen } from "../../api/gitizen";
import { shortHash } from "../../utils/format";
import DiffView, { type LineStaging } from "../common/DiffView";

/**
 * Diff of the file picked in the sidebar, with a header naming the file and
 * where the change lives (a commit's short hash, or Uncommitted), the diff
 * settings, and a button back to the history.
 *
 * Working-tree diffs show every uncommitted change with a checkbox on each
 * changed line, ticked when that line is staged: tick to stage, untick to
 * unstage. The diff itself stays the same either way.
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
  } = useGitOperationsContext();
  const { settings, updateSettings } = useDiffSettings();
  const [applying, setApplying] = useState(false);

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
          loadFile={() =>
            path ? gitizen.fileText(path, selectedCommit?.hash) : Promise.resolve("")
          }
          emptyMessage={
            settings.hideWhitespace ? "No changes besides whitespace." : "No changes to show."
          }
        />
      ) : (
        <p className="placeholder">Select a file in the sidebar.</p>
      )}
    </div>
  );
}
