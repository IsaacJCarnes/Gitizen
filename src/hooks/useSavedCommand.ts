import { useCallback, useEffect, useState } from "react";
import { gitizen } from "../api/gitizen";
import { useGitOperationsContext } from "../context/GitOperationsContext";

export interface SavedCommand {
  /** The saved command: null until loaded, "" when none is set up. */
  command: string | null;
  /** Saves a new command; resolves to what was saved, or null if saving failed (the error is shown). */
  save: (command: string) => Promise<string | null>;
}

/** A command line kept in the backend's settings file, loaded on mount. */
function useSavedCommand(
  load: () => Promise<string>,
  store: (command: string) => Promise<string>,
): SavedCommand {
  const { reportError } = useGitOperationsContext();
  const [command, setCommand] = useState<string | null>(null);

  useEffect(() => {
    // A failed load counts as "not set up", so the setup button still works.
    load().then(setCommand, () => setCommand(""));
  }, [load]);

  const save = useCallback(
    async (next: string): Promise<string | null> => {
      try {
        const saved = await store(next);
        setCommand(saved);
        return saved;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    [store, reportError],
  );

  return { command, save };
}

/** The AI command that writes commit messages. */
export const useAiCommitCommand = (): SavedCommand =>
  useSavedCommand(gitizen.aiCommitCommand, gitizen.setAiCommitCommand);

/** The AI command that resolves conflicted files. */
export const useAiResolveCommand = (): SavedCommand =>
  useSavedCommand(gitizen.aiResolveCommand, gitizen.setAiResolveCommand);

/** The external tool that opens conflicted files. */
export const useEditorCommand = (): SavedCommand =>
  useSavedCommand(gitizen.editorCommand, gitizen.setEditorCommand);
