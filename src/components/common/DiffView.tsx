import "./DiffView.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DiffLayout } from "../../hooks/useDiffSettings";
import TriStateCheckbox from "./TriStateCheckbox";
import { combineStates } from "../../utils/checkState";
import {
  HUNK_HEADER,
  isChange,
  parseDiff,
  toSplitRows,
  type DiffLine,
} from "../../utils/diffLines";

/** Turns on a checkbox beside every added and removed line. */
export interface LineStaging {
  /** Lines (see `DiffLine.index`) that are staged; their checkboxes are ticked. */
  staged: ReadonlySet<number>;
  /** Disables the checkboxes, e.g. while a change is being applied. */
  disabled?: boolean;
  /** Called with the lines to stage (`staged` true) or unstage. */
  onToggle: (lines: number[], staged: boolean) => void;
}

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
}

/** Lines revealed per click of an expand button. */
const EXPAND_STEP = 20;

const MARKERS: Record<string, string> = { add: "+", del: "-", context: " " };

/**
 * git's file header ("diff --git", "index", "---", "+++") only matters to
 * patch tools; the diff view's header already names the file. Other header
 * lines ("new file mode", "Binary files ... differ", renames) are kept.
 */
const FILE_HEADER = /^(diff --git |index |--- |\+\+\+ )/;

/** One hunk: its header, body lines and where it sits in the new file. */
interface Hunk {
  header: DiffLine;
  body: DiffLine[];
  /** First and last new-file line the hunk covers (last < first when it covers none). */
  newFirst: number;
  newLast: number;
  /** Old-file line number minus new-file line number for lines just before the hunk. */
  offsetBefore: number;
  /** The same, for lines just after it. */
  offsetAfter: number;
  /** The hunk is a whole file being added or deleted, so nothing lies outside it. */
  wholeFile: boolean;
}

function toHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of lines) {
    if (line.kind === "hunk") {
      const match = HUNK_HEADER.exec(line.text);
      // A missing length group means a one-line range.
      const [oldStart, oldLen, newStart, newLen] = [1, 2, 3, 4].map((group) =>
        Number(match?.[group] ?? 1),
      );
      // With a zero length, the start is the line the hunk comes after.
      const oldFirst = oldLen === 0 ? oldStart + 1 : oldStart;
      const newFirst = newLen === 0 ? newStart + 1 : newStart;
      hunks.push({
        header: line,
        body: [],
        newFirst,
        newLast: newFirst + newLen - 1,
        offsetBefore: oldFirst - newFirst,
        // The hunk shifts later lines by however many lines it added or removed.
        offsetAfter: oldFirst + oldLen - (newFirst + newLen),
        // "-0,0" is a new file and "+0,0" a deleted one.
        wholeFile: (oldStart === 0 && oldLen === 0) || (newStart === 0 && newLen === 0),
      });
    } else if (hunks.length > 0) {
      const hunk = hunks[hunks.length - 1];
      hunk.body.push(line);
    }
  }
  return hunks;
}

/** Lines of the new file between two hunks (or before the first / after the last). */
interface Gap {
  /** First and last new-file line of the gap; `last` is unknown after the last hunk until the file loads. */
  first: number;
  last?: number;
  /** Old-file line number minus new-file line number inside the gap. */
  offset: number;
  /** Whether a hunk sits above / below the gap. */
  above: boolean;
  below: boolean;
}

/** One gap before each hunk, plus one after the last. */
function toGaps(hunks: Hunk[], fileLineCount?: number): Gap[] {
  return [...hunks, undefined].map((hunk, index) => {
    const previous = hunks[index - 1];
    return {
      first: previous ? previous.newLast + 1 : 1,
      // After the last hunk the gap runs to the end of the file, which is only
      // known once it loads (or at once when the hunk is the whole file).
      last: hunk ? hunk.newFirst - 1 : previous?.wholeFile ? previous.newLast : fileLineCount,
      offset: hunk ? hunk.offsetBefore : (previous?.offsetAfter ?? 0),
      above: Boolean(previous),
      below: Boolean(hunk),
    };
  });
}

/** How much of a gap is shown: lines from its top and from its bottom. */
interface Revealed {
  top: number;
  bottom: number;
}

/** A line's checkbox, or an empty cell that keeps the columns aligned. */
function LineCheck({
  line,
  staging,
}: {
  line?: DiffLine;
  staging?: LineStaging;
}): React.JSX.Element | null {
  if (!staging) return null;
  if (!line || !isChange(line)) return <span className="check" />;
  const staged = staging.staged.has(line.index);
  const action = staged ? "Unstage" : "Stage";
  return (
    <span className="check">
      <input
        type="checkbox"
        checked={staged}
        disabled={staging.disabled}
        onChange={() => staging.onToggle([line.index], !staged)}
        aria-label={`${action} line ${line.newNumber ?? line.oldNumber}`}
        title={`${action} this line`}
      />
    </span>
  );
}

/**
 * The checkbox for a group of changed lines (a run of + and - lines with no
 * unchanged line between them): ticked when all are staged, mixed when some
 * are. Clicking stages the rest, or unstages all when all are staged.
 */
function GroupCheck({
  changes,
  staging,
}: {
  changes: number[];
  staging: LineStaging;
}): React.JSX.Element {
  const state = combineStates(changes.map((index) => staging.staged.has(index)));
  return (
    <TriStateCheckbox
      state={state}
      disabled={staging.disabled}
      onChange={() => staging.onToggle(changes, state !== true)}
      label={state === true ? "Unstage these lines" : "Stage these lines"}
    />
  );
}

/** The line's text, with its +/-/space marker in Unified. An empty line becomes a space so its row keeps its height. */
function lineText(line: DiffLine, withMarker: boolean): string {
  const marker = withMarker ? (MARKERS[line.kind] ?? "") : "";
  return marker + line.text || " ";
}

/**
 * Renders a unified diff with added, removed and hunk-header lines
 * highlighted, in one column or side by side, with optional per-line and
 * per-hunk checkboxes for staging and buttons to expand the unchanged
 * lines between hunks.
 */
export default function DiffView({
  diff,
  layout = "unified",
  lineStaging,
  loadFile,
  emptyMessage = "No changes to show.",
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
  // The hunk checkbox column: left of the lines, or between the two sides.
  const gutter = Boolean(lineStaging);

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

  /**
   * Unified rows or split cells for `body`. With line staging, a column
   * beside them holds a checkbox for each group of changed lines (when
   * `groupChecks` is set; expanded unchanged lines have none).
   */
  const block = (key: string, body: DiffLine[], groupChecks = false): React.JSX.Element => {
    // Each row's changed lines: one line per row in Unified, up to two in Split.
    const rows: (DiffLine | undefined)[][] = split
      ? toSplitRows(body).map((row) => [row.left, row.right])
      : body.map((line) => [line]);
    const rowChanges = rows.map((row) =>
      row.filter((line): line is DiffLine => Boolean(line && isChange(line))).map((line) => line.index),
    );
    // A row is in a group if it has a change. A note ("\ No newline at end
    // of file") belongs to the group it follows.
    const inGroup = rows.map((row, index) =>
      rowChanges[index].length > 0 ||
      (row.some((line) => line?.kind === "note") && index > 0 && rowChanges[index - 1].length > 0),
    );
    // Consecutive group rows merge into one group spanning them.
    const groups: { start: number; span: number; changes: number[] }[] = [];
    inGroup.forEach((member, index) => {
      if (!member) return;
      const last = groups[groups.length - 1];
      if (last && last.start + last.span === index) {
        last.span++;
        last.changes.push(...rowChanges[index]);
      } else {
        groups.push({ start: index, span: 1, changes: [...rowChanges[index]] });
      }
    });

    const cell = (line: DiffLine | undefined, side: "left" | "right" | "", row: number, number?: number): React.JSX.Element => {
      // Grid columns: Unified is [gutter] lines; Split is left [gutter] right.
      let gridColumn = gutter ? 2 : 1;
      if (side === "left") gridColumn = 1;
      if (side === "right") gridColumn = gutter ? 3 : 2;
      return (
        <div
          key={`${side}${row}`}
          className={`diff-line ${side} ${line?.kind ?? "empty"}`}
          style={{ gridRow: row + 1, gridColumn }}
        >
          {side !== "left" && <LineCheck line={line} staging={lineStaging} />}
          {split ? (
            <span className="number">{number}</span>
          ) : (
            <>
              <span className="number">{line?.oldNumber}</span>
              <span className="number">{line?.newNumber}</span>
            </>
          )}
          <span className="code">{line ? lineText(line, !split) : " "}</span>
          {side === "left" && <LineCheck line={line} staging={lineStaging} />}
        </div>
      );
    };

    const cells = rows.flatMap((row, index) =>
      split
        ? [cell(row[0], "left", index, row[0]?.oldNumber), cell(row[1], "right", index, row[1]?.newNumber)]
        : [cell(row[0], "", index)],
    );
    return (
      <div key={key} className={`hunk-block${gutter ? " with-gutter" : ""}`}>
        {gutter &&
          groupChecks &&
          lineStaging &&
          groups.map((group) => (
            <div
              key={`g${group.start}`}
              className="hunk-gutter"
              style={{ gridRow: `${group.start + 1} / span ${group.span}`, gridColumn: split ? 2 : 1 }}
            >
              <GroupCheck changes={group.changes} staging={lineStaging} />
            </div>
          ))}
        {cells}
      </div>
    );
  };

  /** Context lines `from`..`to` (new-file numbers) of a gap, as diff lines. */
  const gapLines = (gap: Gap, from: number, to: number): DiffLine[] => {
    const out: DiffLine[] = [];
    for (let number = from; number <= to; number++) {
      out.push({
        // Negative so it can't clash with a real diff line's index.
        index: -number,
        kind: "context",
        text: fileLines?.[number - 1] ?? "",
        oldNumber: number + gap.offset,
        newNumber: number,
      });
    }
    return out;
  };

  const renderGap = (gap: Gap, index: number): ReactNode => {
    if (!loadFile) return null;
    // Length (and so `hidden`) is unknown for the trailing gap until the file loads.
    const length = gap.last === undefined ? undefined : Math.max(0, gap.last - gap.first + 1);
    if (length === 0) return null;
    const shown = revealed[index] ?? { top: 0, bottom: 0 };
    const hidden = length === undefined ? undefined : length - shown.top - shown.bottom;
    // Once the revealed top and bottom meet, show the gap whole with no button.
    const allShown = hidden !== undefined && hidden <= 0;
    const last = gap.last ?? gap.first - 1;
    const top = allShown
      ? gapLines(gap, gap.first, last)
      : gapLines(gap, gap.first, gap.first + shown.top - 1);
    const bottom = allShown ? [] : gapLines(gap, last - shown.bottom + 1, last);

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
      <div key={`gap${index}`} className="gap">
        {top.length > 0 && block(`gap${index}-top`, top)}
        {!allShown && (
          <div className="diff-line expander">
            <button className="expand" title={title} onClick={() => void expand(index, change)}>
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
        {bottom.length > 0 && block(`gap${index}-bottom`, bottom)}
      </div>
    );
  };

  return (
    <div className={`diff ${split ? "split" : "unified"}`}>
      {notes.map((line) => (
        <div key={line.index} className="diff-line meta">
          <span className="code">{line.text}</span>
        </div>
      ))}
      {hunks.map((hunk, index) => (
        <div key={hunk.header.index}>
          {renderGap(gaps[index], index)}
          <div className="diff-line hunk">
            <span className="code">{hunk.header.text}</span>
          </div>
          {block(`hunk${hunk.header.index}`, hunk.body, true)}
        </div>
      ))}
      {hunks.length > 0 && renderGap(gaps[hunks.length], hunks.length)}
    </div>
  );
}
