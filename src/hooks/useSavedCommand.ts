import { useCallback, useEffect, useState } from "react";
import type { SavedCommandKind } from "../../shared/gitTypes";
import { gitizen } from "../api/gitizen";
import { useGitOperationsContext } from "../context/GitOperationsContext";

export interface SavedCommand {
  /** The saved command: null until loaded, "" when none is set up. */
  command: string | null;
  /** Saves a new command; resolves to what was saved, or null if saving failed (the error is shown). */
  save: (command: string) => Promise<string | null>;
}

/**
 * A command line kept in the backend's settings file (the AI commit or
 * resolve command, or the external merge tool), loaded on mount.
 */
export function useSavedCommand(which: SavedCommandKind): SavedCommand {
  const { reportError } = useGitOperationsContext();
  const [command, setCommand] = useState<string | null>(null);

  useEffect(() => {
    // A failed load counts as "not set up", so the setup button still works.
    gitizen.savedCommand(which).then(setCommand, () => setCommand(""));
  }, [which]);

  const save = useCallback(
    async (next: string): Promise<string | null> => {
      try {
        const saved = await gitizen.saveCommand(which, next);
        setCommand(saved);
        return saved;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    [which, reportError],
  );

  return { command, save };
}
