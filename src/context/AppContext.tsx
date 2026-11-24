import { useContext, createContext } from "react";
import type { GitHubAccountState } from "../hooks/useGitHubAccount";

/**
 * What the main panel shows: "history" is the commit graph, "diff" is the
 * file picked in the sidebar, "conflict" the conflict editor for the
 * conflicted file picked in the sidebar.
 */
export type RepoView = "history" | "diff" | "conflict";

/** UI state shared across components that isn't git data. */
export interface AppData {
  view: RepoView;
  setView: (view: RepoView) => void;
  /** Paths of repositories opened before, most recent first. Saved across restarts. */
  recentRepos: string[];
  /** Removes a repository from `recentRepos` (the folder itself is untouched). */
  forgetRepo: (path: string) => void;
  /**
   * True once the user ticked "don't warn me again" when discarding. Kept
   * in memory only, so the warning comes back the next time Gitizen starts.
   */
  skipDiscardWarning: boolean;
  setSkipDiscardWarning: (skip: boolean) => void;
  /** The GitHub sign-in, which publishing and cloning from GitHub need. */
  github: GitHubAccountState;
}

export const AppContext = createContext<AppData | undefined>(undefined);

/** Reads the UI state provided by `AppProvider`. */
export function useAppContext(): AppData {
  const appData = useContext(AppContext);
  if (!appData) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return appData;
}
