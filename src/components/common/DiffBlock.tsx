import { combineStates } from "../../utils/checkState";
import { lineGroups } from "../../utils/diffHunks";
import { isChange, toSplitRows, type DiffLine } from "../../utils/diffLines";
import TriStateCheckbox from "./TriStateCheckbox";

/** Turns on a checkbox beside every added and removed line. */
export interface LineStaging {
  /** Lines (see `DiffLine.index`) that are staged; their checkboxes are ticked. */
  staged: ReadonlySet<number>;
  /** Disables the checkboxes, e.g. while a change is being applied. */
  disabled?: boolean;
  /** Called with the lines to stage (`staged` true) or unstage. */
  onToggle: (lines: number[], staged: boolean) => void;
}

/** Right-click on a changed line, with the line and every changed line of its group. */
export type LineMenu = (event: React.MouseEvent, line: number, group: number[]) => void;

const MARKERS: Record<string, string> = { add: "+", del: "-", context: " " };

/** The line's text, with its +/-/space marker in Unified. An empty line becomes a space so its row keeps its height. */
function lineText(line: DiffLine, withMarker: boolean): string {
  const marker = withMarker ? (MARKERS[line.kind] ?? "") : "";
  return marker + line.text || " ";
}

/** A line's checkbox, or an empty cell that keeps the columns aligned. */
function LineCheck({ line, staging }: { line?: DiffLine; staging?: LineStaging }): React.JSX.Element | null {
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
function GroupCheck({ changes, staging }: { changes: number[]; staging: LineStaging }): React.JSX.Element {
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

interface CellProps {
  line: DiffLine | undefined;
  /** "" in Unified; the column's side in Split. */
  side: "left" | "right" | "";
  row: number;
  gutter: boolean;
  staging?: LineStaging;
  /** Opens the line menu for a changed line, when there is one. */
  onMenu?: (event: React.MouseEvent, line: DiffLine) => void;
}

/** One line in Unified: both line numbers and the marked text. */
function UnifiedCell({ line, row, gutter, staging, onMenu }: CellProps): React.JSX.Element {
  return (
    <div
      className={`diff-line ${line?.kind ?? "empty"}`}
      style={{ gridRow: row + 1, gridColumn: gutter ? 2 : 1 }}
      onContextMenu={onMenu && line ? (event) => onMenu(event, line) : undefined}
    >
      <LineCheck line={line} staging={staging} />
      <span className="number">{line?.oldNumber}</span>
      <span className="number">{line?.newNumber}</span>
      <span className="code">{line ? lineText(line, true) : " "}</span>
    </div>
  );
}

/** One side of a Split row: that side's line number and text, its checkbox facing the middle. */
function SplitCell({ line, side, row, gutter, staging, onMenu }: CellProps): React.JSX.Element {
  // Grid columns: left [gutter] right.
  const gridColumn = side === "left" ? 1 : gutter ? 3 : 2;
  return (
    <div
      className={`diff-line ${side} ${line?.kind ?? "empty"}`}
      style={{ gridRow: row + 1, gridColumn }}
      onContextMenu={onMenu && line ? (event) => onMenu(event, line) : undefined}
    >
      {side === "right" && <LineCheck line={line} staging={staging} />}
      <span className="number">{side === "left" ? line?.oldNumber : line?.newNumber}</span>
      <span className="code">{line ? lineText(line, false) : " "}</span>
      {side === "left" && <LineCheck line={line} staging={staging} />}
    </div>
  );
}

interface DiffBlockProps {
  body: DiffLine[];
  split: boolean;
  staging?: LineStaging;
  /** Show a checkbox per group of changed lines (expanded unchanged lines have none). */
  groupChecks?: boolean;
  onLineMenu?: LineMenu;
}

/**
 * A run of diff lines as a grid: one column in Unified, removed lines beside
 * the added ones replacing them in Split. With line staging, a column beside
 * them (left in Unified, between the sides in Split) holds a checkbox for
 * each group of changed lines.
 */
export default function DiffBlock({ body, split, staging, groupChecks = false, onLineMenu }: DiffBlockProps): React.JSX.Element {
  const gutter = Boolean(staging);
  // Each row's lines: one per row in Unified, up to two in Split.
  const rows: (DiffLine | undefined)[][] = split
    ? toSplitRows(body).map((row) => [row.left, row.right])
    : body.map((line) => [line]);
  const groups = lineGroups(rows);
  // Each changed line's group, for the line menu.
  const groupOf = new Map<number, number[]>();
  for (const group of groups) {
    for (const change of group.changes) groupOf.set(change, group.changes);
  }
  const onMenu = onLineMenu
    ? (event: React.MouseEvent, line: DiffLine): void => {
        if (!isChange(line)) return;
        event.preventDefault();
        onLineMenu(event, line.index, groupOf.get(line.index) ?? [line.index]);
      }
    : undefined;
  const common = { gutter, staging, onMenu };

  return (
    <div className={`hunk-block${gutter ? " with-gutter" : ""}`}>
      {gutter &&
        groupChecks &&
        staging &&
        groups.map((group) => (
          <div
            key={`g${group.start}`}
            className="hunk-gutter"
            style={{ gridRow: `${group.start + 1} / span ${group.span}`, gridColumn: split ? 2 : 1 }}
          >
            <GroupCheck changes={group.changes} staging={staging} />
          </div>
        ))}
      {rows.flatMap((row, index) =>
        split
          ? [
              <SplitCell key={`left${index}`} line={row[0]} side="left" row={index} {...common} />,
              <SplitCell key={`right${index}`} line={row[1]} side="right" row={index} {...common} />,
            ]
          : [<UnifiedCell key={`${index}`} line={row[0]} side="" row={index} {...common} />],
      )}
    </div>
  );
}
