import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Holds the repository the window currently has open. The app works on one
 * repository at a time, so this is a single module-level slot.
 */
let current: SimpleGit | null = null;

/**
 * Opens `directory` as the current repository.
 * @throws if the folder is not inside a git repository.
 */
export async function openRepository(directory: string): Promise<void> {
  const git = simpleGit(directory);
  if (!(await git.checkIsRepo())) {
    throw new Error("That folder is not a git repository");
  }
  current = git;
}

/**
 * Returns the open repository's git client.
 * @throws if no repository has been opened yet.
 */
export function requireRepository(): SimpleGit {
  if (!current) throw new Error("No repository open");
  return current;
}

/** git's well-known empty tree, used as the "parent" of a root commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Rejects anything that isn't a hex commit hash, so renderer input can never
 * be read by git as an option or a revision expression.
 */
export function assertHash(hash: string): string {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error("Invalid commit hash");
  return hash;
}

/**
 * Returns the first parent of `hash`, or the empty tree for a root commit.
 * Commit diffs are taken against the first parent, so a merge shows what it
 * brought in.
 */
export async function firstParentOf(hash: string): Promise<string> {
  const line = await requireRepository().raw([
    "rev-list", "--parents", "-n", "1", hash,
  ]);
  return line.trim().split(" ")[1] ?? EMPTY_TREE;
}
