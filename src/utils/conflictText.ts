/**
 * Splitting git's conflict-marked text into plain stretches and conflicts,
 * and building the conflict editor's output from the lines picked in each.
 */

import type { Operation } from "../../shared/gitTypes";

/** How each stopped operation is named in the UI. */
export const OPERATION_NAME: Record<Operation, string> = {
  merge: "merge",
  cherryPick: "cherry-pick",
  rebase: "rebase",
  revert: "revert",
};

/** Lines both sides agree on. */
export interface CommonSegment {
  kind: "common";
  lines: string[];
}

/** One conflict: the current branch's lines and the incoming lines. */
export interface ConflictSegment {
  kind: "conflict";
  /** Which conflict of the file this is, counting from 0; used in `lineKey`. */
  index: number;
  current: string[];
  incoming: string[];
}

export type Segment = CommonSegment | ConflictSegment;

export interface ParsedConflict {
  segments: Segment[];
  /** Whether the text ended with a newline, which the output keeps. */
  finalNewline: boolean;
}

/** Which side of a conflict a line comes from. */
export type Side = "current" | "incoming";

/** Key of one picked line: conflict number, side, and line within that side. */
export const lineKey = (conflict: number, side: Side, line: number): string =>
  `${conflict}:${side}:${line}`;

/** A marker is exactly 7 characters, alone or followed by a space and a label. */
const isMarker = (line: string, char: string): boolean =>
  line.startsWith(char.repeat(7)) && (line.length === 7 || line[7] === " ");

/** True if any line opens a conflict, i.e. the text still needs resolving. */
export const hasConflictMarkers = (text: string): boolean =>
  text.split("\n").some((line) => isMarker(line, "<"));

/**
 * Parses `git merge-file` output: `<<<<<<<` opens a conflict, `=======`
 * separates current from incoming, `>>>>>>>` closes it. A `|||||||` section
 * (the common ancestor, in diff3 style) is skipped.
 */
export function parseConflict(text: string): ParsedConflict {
  const normalized = text.replace(/\r\n/g, "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = (finalNewline ? normalized.slice(0, -1) : normalized).split("\n");
  if (normalized === "") return { segments: [], finalNewline: false };

  const segments: Segment[] = [];
  let common: string[] = [];
  let conflict: ConflictSegment | null = null;
  let conflictCount = 0;
  // Every line of the open conflict, markers included, in case it never closes.
  let raw: string[] = [];
  // Where lines inside a conflict go: current side, base (skipped) or incoming.
  let part: "current" | "base" | "incoming" = "current";

  for (const line of lines) {
    if (conflict) raw.push(line);
    if (!conflict && isMarker(line, "<")) {
      if (common.length > 0) segments.push({ kind: "common", lines: common });
      common = [];
      conflict = { kind: "conflict", index: conflictCount++, current: [], incoming: [] };
      raw = [line];
      part = "current";
    } else if (conflict && part !== "incoming" && isMarker(line, "|")) {
      part = "base";
    } else if (conflict && part !== "incoming" && line === "=======") {
      part = "incoming";
    } else if (conflict && part === "incoming" && isMarker(line, ">")) {
      segments.push(conflict);
      conflict = null;
    } else if (conflict) {
      if (part === "current") conflict.current.push(line);
      else if (part === "incoming") conflict.incoming.push(line);
    } else {
      common.push(line);
    }
  }
  // An unterminated conflict (malformed input) is shown as plain text.
  if (conflict) common.push(...raw);
  if (common.length > 0) segments.push({ kind: "common", lines: common });
  return { segments, finalNewline };
}

/**
 * The output for the picked lines: plain stretches as they are, and for
 * each conflict its picked lines in the order they were picked (a Set keeps
 * insertion order), whichever side they come from. A conflict with nothing
 * picked contributes nothing.
 */
export function buildOutput(parsed: ParsedConflict, picked: ReadonlySet<string>): string {
  const out: string[] = [];
  for (const segment of parsed.segments) {
    if (segment.kind === "common") {
      out.push(...segment.lines);
      continue;
    }
    const prefix = `${segment.index}:`;
    for (const key of picked) {
      if (!key.startsWith(prefix)) continue;
      // Keys are "<conflict>:<side>:<line>" (see `lineKey`).
      const [, side, line] = key.split(":");
      const text = segment[side as Side][Number(line)];
      if (text !== undefined) out.push(text);
    }
  }
  const text = out.join("\n");
  return parsed.finalNewline && out.length > 0 ? `${text}\n` : text;
}

/** Keys of every line on one side of every conflict, e.g. for "Take all current". */
export const sideKeys = (parsed: ParsedConflict, side: Side): string[] =>
  parsed.segments.flatMap((segment) =>
    segment.kind === "conflict"
      ? segment[side].map((_, line) => lineKey(segment.index, side, line))
      : [],
  );
