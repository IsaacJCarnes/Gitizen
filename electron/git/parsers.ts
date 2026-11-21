/**
 * Pure functions that turn raw git output into the shared data types.
 * Kept free of Electron and simple-git so they are easy to test.
 */
import type { CommitFile, GitCommit, GitRef } from "../../shared/gitTypes";

/** Field and record separators used in the `git log --format` string. */
const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

/** `--format` for `git log` that `parseLog` understands. */
export const LOG_FORMAT = [
  "%H", "%P", "%D", "%an", "%aI", "%s", "%b",
].join("%x1f") + "%x1e";

/**
 * Parses a `%D` decoration produced with `--decorate=full`, e.g.
 * "HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main".
 * Symbolic remote HEADs such as "origin/HEAD" are dropped.
 */
export function parseRefs(decoration: string): GitRef[] {
  return decoration
    .split(", ")
    .filter(Boolean)
    .map((ref): GitRef => {
      if (ref.startsWith("HEAD -> refs/heads/"))
        return { name: ref.slice("HEAD -> refs/heads/".length), type: "branch", current: true };
      if (ref === "HEAD") return { name: "HEAD", type: "head", current: true };
      if (ref.startsWith("tag: refs/tags/"))
        return { name: ref.slice("tag: refs/tags/".length), type: "tag" };
      if (ref.startsWith("refs/heads/"))
        return { name: ref.slice("refs/heads/".length), type: "branch" };
      if (ref.startsWith("refs/remotes/"))
        return { name: ref.slice("refs/remotes/".length), type: "remote" };
      return { name: ref, type: "branch" };
    })
    .filter((ref) => !ref.name.endsWith("/HEAD"));
}

/** Parses `git log` output written with `LOG_FORMAT`. */
export function parseLog(output: string): GitCommit[] {
  return output
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, parents, refs, author, date, message, body] =
        record.split(FIELD_SEP);
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        refs: parseRefs(refs),
        author,
        date,
        message,
        body: body.trim(),
      };
    });
}

/**
 * Parses `git diff --name-status -z` output. Renames and copies carry two
 * paths (old, then new); every other status carries one.
 */
export function parseNameStatus(output: string): CommitFile[] {
  const parts = output.split("\0").filter(Boolean);
  const files: CommitFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      files.push({ code: status[0], oldPath: parts[i + 1], path: parts[i + 2] });
      i += 3;
    } else {
      files.push({ code: status[0], path: parts[i + 1] });
      i += 2;
    }
  }
  return files;
}
