import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppContext, type RepoView } from "./AppContext";
import { GitOperationsContext } from "./GitOperationsContext";
import { useGitOperations } from "../hooks/useGitOperations";
import { useGitHubAccount } from "../hooks/useGitHubAccount";
import { gitizen } from "../api/gitizen";

/** Provides both the UI state (AppContext) and the git state (GitOperationsContext). */
export function AppProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [view, setView] = useState<RepoView>("history");
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  // Deliberately not saved anywhere: it lasts until the app is closed.
  const [skipDiscardWarning, setSkipDiscardWarning] = useState(false);

  // The saved list lives in the backend (a JSON file in the app's config
  // folder). Failing to read or write it only affects the switcher, so
  // errors are logged rather than shown.
  useEffect(() => {
    gitizen.recentRepos().then(setRecentRepos).catch(console.error);
  }, []);

  const rememberRepo = useCallback((path: string): void => {
    gitizen.rememberRepo(path).then(setRecentRepos).catch(console.error);
  }, []);

  const forgetRepo = useCallback((path: string): void => {
    gitizen.forgetRepo(path).then(setRecentRepos).catch(console.error);
  }, []);

  const operations = useGitOperations({ onRepositoryOpened: rememberRepo });
  const github = useGitHubAccount(operations.reportError);
  const appData = useMemo(
    () => ({ view, setView, recentRepos, forgetRepo, skipDiscardWarning, setSkipDiscardWarning, github }),
    [view, recentRepos, forgetRepo, skipDiscardWarning, github],
  );

  return (
    <AppContext.Provider value={appData}>
      <GitOperationsContext.Provider value={operations}>
        {children}
      </GitOperationsContext.Provider>
    </AppContext.Provider>
  );
}
