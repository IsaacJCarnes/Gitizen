import "./DiffView.css";
import { useEffect, useMemo, useState } from "react";
import type { DiffLayout } from "../../hooks/useDiffSettings";
import { gapLines, toGaps, toHunks, type Gap } from "../../utils/diffHunks";
import { parseDiff } from "../../utils/diffLines";
import DiffBlock, { type LineMenu, type LineStaging } from "./DiffBlock";

export type { LineStaging } from "./DiffBlock";

interface DiffViewProps {
  /** Unified diff text as returned by git. */
  diff: string;
  layout?: DiffLayout;
  /** Leave out for diffs that can't be staged, such as a commit's. */
  lineStaging?: LineStaging;
  /**
   * Loads the file's text (the diff's new side), so the lines the diff
   * hides between hunks can be expanded. Leave out to disable expanding.
   */
  loadFile?: () => Promise<string>;
  /** Shown when the diff is empty. */
  emptyMessage?: string;
  /**
   * Right-click on an added or removed line, with the line (see
   * `DiffLine.index`) and every changed line of its group (the run of
   * changes it belongs to). Leave out for no menu.
   */
  onLineMenu?: LineMenu;
}

/** Lines revealed per click of an expand button. */
const EXPAND_STEP = 20;

/**
 * git's file header ("diff --git", "index", "---", "+++") only matters to
 * patch tools; the diff view's header already names the file. Other header
 * lines ("new file mode", "Binary files ... differ", renames) are kept.
 */
const FILE_HEADER = /^(diff --git |index |--- |\+\+\+ )/;

/** How much of a gap is shown: lines from its top and from its bottom. */
interface Revealed {
  top: number;
  bottom: number;
}

interface DiffGapProps {
  gap: Gap;
  shown: Revealed;
  fileLines: string[] | null;
  loadFailed: boolean;
  split: boolean;
  /** The diff's line staging, so the gap's columns line up with the hunks'. */
  staging?: LineStaging;
  /** Reveals more of the gap (loading the file first if needed). */
  onExpand: (change: (gap: Revealed) => Revealed) => void;
}

/**
 * The unchanged lines between two hunks (or before the first, after the
 * last): those revealed so far, and a button to reveal more.
 */
function DiffGap({ gap, shown, fileLines, loadFailed, split, staging, onExpand }: DiffGapProps): React.JSX.Element | null {
  // Length (and so `hidden`) is unknown for the trailing gap until the file loads.
  const length = gap.last === undefined ? undefined : Math.max(0, gap.last - gap.first + 1);
  if (length === 0) return null;
  const hidden = length === undefined ? undefined : length - shown.top - shown.bottom;
  // Once the revealed top and bottom meet, show the gap whole with no button.
  const allShown = hidden !== undefined && hidden <= 0;
  const last = gap.last ?? gap.first - 1;
  const top = allShown
    ? gapLines(gap, gap.first, last, fileLines)
    : gapLines(gap, gap.first, gap.first + shown.top - 1, fileLines);
  const bottom = allShown ? [] : gapLines(gap, last - shown.bottom + 1, last, fileLines);

  // One button: up for lines above the first hunk, down for lines below
  // the last, and out (both directions) between two hunks.
  let label = "↕ Expand";
  let title = `Show ${EXPAND_STEP} more lines on each side`;
  let change = (g: Revealed): Revealed => ({ top: g.top + EXPAND_STEP, bottom: g.bottom + EXPAND_STEP });
  if (!gap.above) {
    label = "↑ Expand up";
    title = `Show ${EXPAND_STEP} more lines above`;
    change = (g) => ({ ...g, bottom: g.bottom + EXPAND_STEP });
  } else if (!gap.below) {
    label = "↓ Expand down";
    title = `Show ${EXPAND_STEP} more lines below`;
    change = (g) => ({ ...g, top: g.top + EXPAND_STEP });
  }
  return (
    <div className="gap">
      {top.length > 0 && <DiffBlock body={top} split={split} staging={staging} />}
      {!allShown && (
        <div className="diff-line expander">
          <button className="expand" title={title} onClick={() => onExpand(change)}>
            {label}
          </button>
          <span className="code">
            {loadFailed
              ? "Couldn't load the file"
              : hidden !== undefined
                ? `${hidden} unchanged line${hidden === 1 ? "" : "s"}`
                : "Unchanged lines below"}
          </span>
        </div>
      )}
      {bottom.length > 0 && <DiffBlock body={bottom} split={split} staging={staging} />}
    </div>
  );
}

/**
 * Renders a unified diff with added, removed and hunk-header lines
 * highlighted, in one column or side by side, with optional per-line and
 * per-hunk checkboxes for staging and buttons to expand the unchanged
 * lines between hunks. The hunks and gaps come from `utils/diffHunks.ts`
 * and their lines are drawn by `DiffBlock`.
 */
export default function DiffView({
  diff,
  layout = "unified",
  lineStaging,
  loadFile,
  emptyMessage = "No changes to show.",
  onLineMenu,
}: DiffViewProps): React.JSX.Element {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const notes = lines.filter((line) => line.kind === "meta" && !FILE_HEADER.test(line.text));
  const hunks = useMemo(() => toHunks(lines), [lines]);

  // The file's lines (loaded on the first expand) and how much of each gap
  // is shown. Both start over whenever the diff changes.
  const [fileLines, setFileLines] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState<Record<number, Revealed>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setFileLines(null);
    setRevealed({});
    setLoadFailed(false);
  }, [diff]);

  const gaps = useMemo(() => toGaps(hunks, fileLines?.length), [hunks, fileLines]);

  if (!diff) {
    return <p className="placeholder">{emptyMessage}</p>;
  }

  const split = layout === "split";

  const expand = async (gapIndex: number, change: (gap: Revealed) => Revealed): Promise<void> => {
    let file = fileLines;
    if (!file) {
      try {
        const text = await (loadFile?.() ?? Promise.resolve(""));
        file = text === "" ? [] : text.replace(/\n$/, "").split("\n");
        setFileLines(file);
      } catch {
        setLoadFailed(true);
        return;
      }
    }
    setRevealed((current) => ({
      ...current,
      [gapIndex]: change(current[gapIndex] ?? { top: 0, bottom: 0 }),
    }));
  };

  const gap = (index: number): React.JSX.Element | null =>
    loadFile ? (
      <DiffGap
        key={`gap${index}`}
        gap={gaps[index]}
        shown={revealed[index] ?? { top: 0, bottom: 0 }}
        fileLines={fileLines}
        loadFailed={loadFailed}
        split={split}
        staging={lineStaging}
        onExpand={(change) => void expand(index, change)}
      />
    ) : null;

  return (
    <div className={`diff ${split ? "split" : "unified"}`}>
      {notes.map((line) => (
        <div key={line.index} className="diff-line meta">
          <span className="code">{line.text}</span>
        </div>
      ))}
      {hunks.map((hunk, index) => (
        <div key={hunk.header.index}>
          {gap(index)}
          <div className="diff-line hunk">
            <span className="code">{hunk.header.text}</span>
          </div>
          <DiffBlock body={hunk.body} split={split} staging={lineStaging} groupChecks onLineMenu={onLineMenu} />
        </div>
      ))}
      {hunks.length > 0 && gap(hunks.length)}
    </div>
  );
}
