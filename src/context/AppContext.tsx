import { useContext, createContext } from "react";

// "history" lists commits in the main panel; "diff" shows the file picked in the sidebar.
export type RepoView = "history" | "diff";

export interface AppData {
  view: RepoView;
  setView: (view: RepoView) => void;
}

export const AppContext = createContext<AppData | undefined>(undefined);

export function useAppContext() {
  const appData = useContext(AppContext);
  if (!appData) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return appData;
}
