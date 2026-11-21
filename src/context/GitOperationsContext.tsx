import { useContext, createContext } from "react";
import type { GitOperations } from "../hooks/useGitOperations";

export const GitOperationsContext = createContext<GitOperations | undefined>(
  undefined,
);

/** Reads the git state and actions provided by `AppProvider`. */
export function useGitOperationsContext(): GitOperations {
  const operations = useContext(GitOperationsContext);
  if (!operations) {
    throw new Error("useGitOperationsContext must be used within an AppProvider");
  }
  return operations;
}
