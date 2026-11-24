/** Small formatting helpers shared by the UI. */

/** Abbreviates a commit hash to the usual 7 characters. */
export const shortHash = (hash: string): string => hash.slice(0, 7);

/** "1 file", "3 files". */
export const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * A change's path, plus the path it was renamed from: git needs both to
 * stage, unstage or discard a rename.
 */
export const renamePaths = ({ path, oldPath }: { path: string; oldPath?: string }): string[] =>
  oldPath ? [path, oldPath] : [path];

/** How long ago `time` (milliseconds since 1970) was, e.g. "just now" or "5 minutes ago". */
export function timeAgo(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${pluralize(minutes, "minute")} ago`;
  return `${pluralize(Math.floor(minutes / 60), "hour")} ago`;
}

/** Last segment of a path, e.g. "D:\\Github\\Gitizen" -> "Gitizen". */
export const baseName = (path: string): string | undefined =>
  path.split(/[\\/]/).pop();

/**
 * A commit message from the commit form's fields, by git convention: the
 * summary (subject), then a blank line and the description (body) if any.
 */
export function joinMessage(summary: string, description: string): string {
  const body = description.trim();
  return body ? `${summary.trim()}\n\n${body}` : summary.trim();
}

/** Splits a commit message into the form's summary (first line) and description. */
export function splitMessage(message: string): [summary: string, description: string] {
  const [summary, ...rest] = message.split("\n");
  return [summary, rest.join("\n").trim()];
}
