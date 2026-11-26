/** Unfinished commit messages, one per repository path, saved in localStorage. */
import { readStorage, writeStorage } from "./storage";

export interface CommitDraft {
  summary: string;
  description: string;
}

const DRAFTS_KEY = "gitizen.commitDrafts";

function loadDrafts(): Record<string, CommitDraft> {
  try {
    const saved: unknown = JSON.parse(readStorage(DRAFTS_KEY) ?? "null");
    return typeof saved === "object" && saved !== null ? (saved as Record<string, CommitDraft>) : {};
  } catch {
    return {};
  }
}

/** `repo`'s saved draft, if it has one. */
export function loadDraft(repo: string): CommitDraft | undefined {
  return loadDrafts()[repo];
}

/** Saves `repo`'s draft (removing it when both fields are empty). */
export function saveDraft(repo: string, summary: string, description: string): void {
  const drafts = loadDrafts();
  if (summary.trim() || description.trim()) drafts[repo] = { summary, description };
  else delete drafts[repo];
  writeStorage(DRAFTS_KEY, JSON.stringify(drafts));
}
