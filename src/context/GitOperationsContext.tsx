import { useContext, createContext } from "react";
import type { GitOperations } from "../hooks/useGitOperations";

export const GitOperationsContext = createContext<GitOperations | undefined>(
  undefined,
);

export function useGitOperationsContext(): GitOperations {
  const operations = useContext(GitOperationsContext);
  if (!operations) {
    throw new Error(
      "useGitOperationsContext must be used within a GitOperationsProvider",
    );
  }
  return operations;
}
