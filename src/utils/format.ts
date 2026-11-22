/** Small formatting helpers shared by the UI. */

/** Abbreviates a commit hash to the usual 7 characters. */
export const shortHash = (hash: string): string => hash.slice(0, 7);

/** "1 file", "3 files". */
export const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Last segment of a path, e.g. "D:\\Github\\Gitizen" -> "Gitizen". */
export const baseName = (path: string): string | undefined =>
  path.split(/[\\/]/).pop();
