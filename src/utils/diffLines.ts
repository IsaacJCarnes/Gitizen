/**
 * Parses one file's unified diff into lines the diff view can lay out in a
 * single column or side by side. Pure, so it can be tested without React.
 */

export type DiffLineKind = "meta" | "hunk" | "add" | "del" | "context" | "note";

export interface DiffLine {
  /**
   * Position in `diff.split("\n")`. This is how the backend's
   * `file_diff` and `set_staged_lines` commands identify lines, so keep it as is.
   */
  index: number;
  /**
   * "meta" is a file header line (before the first hunk), "hunk" an `@@`
   * line, "note" git's "\ No newline at end of file".
   */
  kind: DiffLineKind;
  /** The line without its +, - or space marker (whole line for meta, hunk and note). */
  text: string;
  /** Line number in the old file, for context and removed lines. */
  oldNumber?: number;
  /** Line number in the new file, for context and added lines. */
  newNumber?: number;
  /** Index of the hunk header this line belongs to. */
  hunk?: number;
}

/** One row of the side-by-side layout. */
export interface SplitRow {
  /** Meta and hunk lines span both sides. */
  full?: DiffLine;
  left?: DiffLine;
  right?: DiffLine;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunks = false;
  let hunk = -1;
  let oldNumber = 0;
  let newNumber = 0;

  diff.split("\n").forEach((line, index) => {
    if (line === "") return; // only the piece after the final newline
    const header = HUNK_HEADER.exec(line);
    if (header) {
      inHunks = true;
      hunk = index;
      oldNumber = Number(header[1]);
      newNumber = Number(header[2]);
      lines.push({ index, kind: "hunk", text: line });
      return;
    }
    if (!inHunks) {
      lines.push({ index, kind: "meta", text: line });
      return;
    }
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      lines.push({ index, kind: "add", text, newNumber: newNumber++, hunk });
    } else if (marker === "-") {
      lines.push({ index, kind: "del", text, oldNumber: oldNumber++, hunk });
    } else if (marker === "\\") {
      lines.push({ index, kind: "note", text: line, hunk });
    } else {
      lines.push({
        index,
        kind: "context",
        text,
        oldNumber: oldNumber++,
        newNumber: newNumber++,
        hunk,
      });
    }
  });
  return lines;
}

/** True for added and removed lines, the ones that can be staged one at a time. */
export function isChange(line: DiffLine): boolean {
  return line.kind === "add" || line.kind === "del";
}

/**
 * Pairs each run of removed lines with the added lines after it, so a
 * changed line sits beside its replacement. Context appears on both sides.
 */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let left: DiffLine[] = [];
  let right: DiffLine[] = [];
  // Which side a "\ No newline" note follows.
  let lastSide: DiffLine[] = left;

  const flush = (): void => {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      rows.push({ left: left[i], right: right[i] });
    }
    left = [];
    right = [];
    lastSide = left;
  };

  for (const line of lines) {
    if (line.kind === "del") {
      // A removal after additions starts a new block.
      if (right.length > 0) flush();
      left.push(line);
      lastSide = left;
    } else if (line.kind === "add") {
      right.push(line);
      lastSide = right;
    } else if (line.kind === "note") {
      if (left.length + right.length > 0) lastSide.push(line);
      else rows.push({ left: line, right: line });
    } else {
      flush();
      if (line.kind === "context") rows.push({ left: line, right: line });
      else rows.push({ full: line });
    }
  }
  flush();
  return rows;
}
