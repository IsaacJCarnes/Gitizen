import { type PropsWithChildren } from "react";
import { useGitOperations } from "../hooks/useGitOperations";
import { GitOperationsContext } from "./GitOperationsContext";

export function AppProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const operations = useGitOperations();

  return (
    <GitOperationsContext.Provider value={operations}>
      {children}
    </GitOperationsContext.Provider>
  );
}
