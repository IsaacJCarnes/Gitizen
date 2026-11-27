/**
 * Hunks and the gaps between them, for the diff view: git's hunks split at
 * every run of unchanged lines between changes, the hidden lines around
 * them, and the groups of changed lines that stage together. Pure functions
 * over `parseDiff`'s lines, so they can be tested without React.
 */
import { HUNK_HEADER, isChange, type DiffLine } from "./diffLines";

/** One hunk: its header, body lines and where it sits in the new file. */
export interface Hunk {
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

/**
 * git's hunks, each split wherever unchanged lines sit between two runs of
 * changes, so every run of changes is a hunk of its own. The unchanged lines
 * between them become a gap, folded away like the lines between git's hunks;
 * the context git shows before the first and after the last change stays.
 */
export function toHunks(lines: DiffLine[]): Hunk[] {
  const hunks: Hunk[] = [];
  let header: DiffLine | null = null;
  let body: DiffLine[] = [];
  const flush = (): void => {
    if (header) hunks.push(...splitHunk(header, body));
    body = [];
  };
  for (const line of lines) {
    if (line.kind === "hunk") {
      flush();
      header = line;
    } else if (header) {
      body.push(line);
    }
  }
  flush();
  return hunks;
}

/** One of git's hunks, split at the unchanged lines between its runs of changes. */
function splitHunk(header: DiffLine, body: DiffLine[]): Hunk[] {
  const match = HUNK_HEADER.exec(header.text);
  // A missing length group means a one-line range.
  const [oldStart, oldLen, newStart, newLen] = [1, 2, 3, 4].map((group) => Number(match?.[group] ?? 1));
  // "-0,0" is a new file and "+0,0" a deleted one.
  const wholeFile = (oldStart === 0 && oldLen === 0) || (newStart === 0 && newLen === 0);
  // With a zero length, the start is the line the hunk comes after.
  let oldNext = oldLen === 0 ? oldStart + 1 : oldStart;
  let newNext = newLen === 0 ? newStart + 1 : newStart;

  // Where each piece starts in `body`: after each run of unchanged lines
  // that has changes both before and after it.
  const isChangeOrNote = (line: DiffLine): boolean => line.kind !== "context";
  const pieces: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i].kind !== "context" || i === 0 || !isChangeOrNote(body[i - 1])) continue;
    let end = i;
    while (end < body.length && body[end].kind === "context") end++;
    const changeAfter = end < body.length && (body[end].kind === "add" || body[end].kind === "del");
    if (changeAfter && body.slice(0, i).some(isChangeOrNote)) {
      pieces.push({ start, end: i });
      pieces.push({ start: i, end }); // the unchanged lines between, dropped below
      start = end;
    }
    i = end - 1;
  }
  pieces.push({ start, end: body.length });

  const hunks: Hunk[] = [];
  pieces.forEach(({ start: from, end: to }, index) => {
    const part = body.slice(from, to);
    const olds = part.filter((line) => line.oldNumber !== undefined).length;
    const news = part.filter((line) => line.newNumber !== undefined).length;
    // Odd pieces are the unchanged lines between two runs: skipped over.
    if (index % 2 === 0) {
      const range = `@@ -${olds ? oldNext : oldNext - 1},${olds} +${news ? newNext : newNext - 1},${news} @@`;
      // git's hint naming the enclosing function or block stays on the first piece.
      const text = pieces.length === 1 ? header.text : index === 0 ? header.text.replace(HUNK_HEADER, range) : range;
      hunks.push({
        // The first piece keeps git's header (and its index); the rest get
        // one of their own, keyed by their first line.
        header: index === 0 ? { ...header, text } : { index: -1e9 - part[0].index, kind: "hunk", text },
        body: part,
        newFirst: newNext,
        newLast: newNext + news - 1,
        offsetBefore: oldNext - newNext,
        // The hunk shifts later lines by however many lines it added or removed.
        offsetAfter: oldNext + olds - (newNext + news),
        wholeFile,
      });
    }
    oldNext += olds;
    newNext += news;
  });
  return hunks;
}

/** Lines of the new file between two hunks (or before the first / after the last). */
export interface Gap {
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
export function toGaps(hunks: Hunk[], fileLineCount?: number): Gap[] {
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

/** Unchanged lines `from`..`to` (new-file numbers) of a gap, as diff lines, from the loaded file. */
export function gapLines(gap: Gap, from: number, to: number, fileLines: string[] | null): DiffLine[] {
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
}

/** A group of changed lines: rows `start` to `start + span - 1`, and their lines' indices. */
export interface LineGroup {
  start: number;
  span: number;
  changes: number[];
}

/**
 * The groups of changed lines among `rows` (each row holds one line in
 * Unified, up to two in Split): consecutive rows with changes, plus a note
 * ("\ No newline at end of file") right after one. Each group stages
 * together.
 */
export function lineGroups(rows: (DiffLine | undefined)[][]): LineGroup[] {
  const rowChanges = rows.map((row) =>
    row.filter((line): line is DiffLine => Boolean(line && isChange(line))).map((line) => line.index),
  );
  const inGroup = rows.map(
    (row, index) =>
      rowChanges[index].length > 0 ||
      (row.some((line) => line?.kind === "note") && index > 0 && rowChanges[index - 1].length > 0),
  );
  const groups: LineGroup[] = [];
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
  return groups;
}
