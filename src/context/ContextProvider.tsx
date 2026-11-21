import { createContext, useContext, type PropsWithChildren } from "react";
import { useGitOperations } from "../hooks/useGitOperations";
import type { GitOperations } from "../hooks/useGitOperations";

const GitOperationsContext = createContext<GitOperations | undefined>(
  undefined,
);

export function ContextProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const operations = useGitOperations();

  return (
    <GitOperationsContext.Provider value={operations}>
      {children}
    </GitOperationsContext.Provider>
  );
}

export function useGitOperationsContext(): GitOperations {
  const operations = useContext(GitOperationsContext);
  if (!operations) {
    throw new Error(
      "useGitOperationsContext must be used within a GitOperationsProvider",
    );
  }
  return operations;
}
