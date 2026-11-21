import { useMemo, useState, type PropsWithChildren } from "react";
import { AppContext, type RepoView } from "./AppContext";
import { GitOperationsContext } from "./GitOperationsContext";
import { useGitOperations } from "../hooks/useGitOperations";

/** Provides both the UI state (AppContext) and the git state (GitOperationsContext). */
export function AppProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [view, setView] = useState<RepoView>("history");
  const appData = useMemo(() => ({ view, setView }), [view]);
  const operations = useGitOperations();

  return (
    <AppContext.Provider value={appData}>
      <GitOperationsContext.Provider value={operations}>
        {children}
      </GitOperationsContext.Provider>
    </AppContext.Provider>
  );
}
