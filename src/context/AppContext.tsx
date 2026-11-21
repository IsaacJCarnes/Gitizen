import { useContext, createContext } from "react";

export type RepoView = "changes" | "history";

export interface AppData {
  view: string;
  setView: (name: string) => void;
}

export const AppContext = createContext<AppData | undefined>(undefined);

export function useAppContext() {
  const appData = useContext(AppContext);
  if (!appData) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return appData;
}
