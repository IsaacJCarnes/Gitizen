import { useState, type PropsWithChildren } from "react";
import { AppContext } from "./AppContext";
import { useGitOperations } from "../hooks/useGitOperations";
import { GitOperationsContext } from "./GitOperationsContext";

export function AppProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const [view, setView] = useState("");
  const operations = useGitOperations();

  return (
    <AppContext.Provider value={{ view: view, setView: setView }}>
      <GitOperationsContext.Provider value={operations}>
        {children}
      </GitOperationsContext.Provider>
    </AppContext.Provider>
  );
}
