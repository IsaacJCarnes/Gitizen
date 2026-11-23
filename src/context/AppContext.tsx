import { useContext, createContext } from "react";

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
