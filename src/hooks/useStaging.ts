import { useCallback, useEffect, useRef, useState } from "react";
import { gitizen } from "../api/gitizen";

interface StagingOptions {
  /** Reloads the working state (status, conflicts, stamps) only. */
  refreshWorking: () => Promise<void>;
  reportError: (caught: unknown) => void;
  /** The working-tree file whose diff is shown, its diff text, and whether whitespace is hidden. */
  selectedPath: string | null;
  diff: string;
  hideWhitespace: boolean;
}

interface Staging {
  /** Stages (`staged` true) or unstages every given path. */
  setFilesStaged: (paths: string[], staged: boolean) => Promise<boolean>;
  /** Stages or unstages single lines of the selected file (see `GitOperations.stageLines`). */
  stageLines: (lines: number[], staged: boolean) => Promise<boolean>;
  /** Files ticked or unticked whose staging hasn't shown up in the status yet: path to staged. */
  pendingFiles: ReadonlyMap<string, boolean>;
  /** The same for lines of the selected file's diff: line index to staged. */
  pendingLines: ReadonlyMap<number, boolean>;
  /** Resolves once every queued staging change is done and refreshed. */
  whenIdle: () => Promise<void>;
  /**
   * How many staging changes have been queued so far, and whether none is
   * left: a diff loaded after the last one, with none left, replaces the
   * pending lines (see `diffLoaded`).
   */
  queued: () => number;
  /** Changes with each burst of staging, to make the selected file's diff reload. */
  reloadToken: number;
  /** Call with `queued()` from when a diff load started, once it arrives. */
  diffLoaded: (queuedWhenStarted: number) => void;
}

/**
 * Staging whole files and single lines without making the UI wait. A
 * checkbox shows its new state at once (`pendingFiles`, `pendingLines`),
 * while the git calls run one after another in the background. Once the
 * last one is done, one working-state refresh shows git's real state and
 * the pending marks go. A failure shows in the error modal, and the
 * refresh puts the checkbox back.
 *
 * Other actions wait for the queue first (`whenIdle`), so a commit always
 * sees everything that was ticked before it. Part of `useGitOperations`.
 */
export function useStaging({
  refreshWorking,
  reportError,
  selectedPath,
  diff,
  hideWhitespace,
}: StagingOptions): Staging {
  const [pendingFiles, setPendingFiles] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [pendingLines, setPendingLines] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [reloadToken, setReloadToken] = useState(0);
  // The last queued step (each runs after the one before), how many are
  // waiting, and how many were ever queued.
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const count = useRef(0);

  // Lines are indices into one file's diff; another file's diff starts afresh.
  useEffect(() => setPendingLines(new Map()), [selectedPath]);

  /** Queues `call`; resolves to whether it worked. */
  const enqueue = useCallback(
    (call: () => Promise<unknown>): Promise<boolean> => {
      waiting.current++;
      count.current++;
      const step = tail.current.then(() =>
        call().then(
          () => true,
          (error: unknown) => {
            reportError(error);
            return false;
          },
        ),
      );
      tail.current = step.then(async () => {
        if (--waiting.current > 0) return;
        // The last of a burst: show git's real state.
        await refreshWorking();
        if (waiting.current === 0) {
          setPendingFiles(new Map());
          setReloadToken((token) => token + 1);
        }
      });
      return step;
    },
    [refreshWorking, reportError],
  );

  const setFilesStaged = useCallback(
    (paths: string[], staged: boolean): Promise<boolean> => {
      if (paths.length === 0) return Promise.resolve(true);
      setPendingFiles((current) => new Map([...current, ...paths.map((path) => [path, staged] as const)]));
      return enqueue(() => (staged ? gitizen.stage(paths) : gitizen.unstage(paths)));
    },
    [enqueue],
  );

  const stageLines = useCallback(
    (lines: number[], staged: boolean): Promise<boolean> => {
      // Lines of a whitespace-hidden diff can't be mapped back onto the file.
      if (!selectedPath || lines.length === 0 || hideWhitespace) return Promise.resolve(false);
      setPendingLines((current) => new Map([...current, ...lines.map((line) => [line, staged] as const)]));
      const path = selectedPath;
      return enqueue(() => gitizen.setStagedLines(path, diff, lines, staged));
    },
    [selectedPath, diff, hideWhitespace, enqueue],
  );

  const whenIdle = useCallback(async (): Promise<void> => {
    // New steps may be queued while waiting; wait until none is left.
    while (waiting.current > 0) await tail.current;
  }, []);

  const queued = useCallback((): number => (waiting.current > 0 ? -1 : count.current), []);

  const diffLoaded = useCallback((queuedWhenStarted: number): void => {
    if (queuedWhenStarted !== -1 && queuedWhenStarted === count.current && waiting.current === 0) {
      setPendingLines(new Map());
    }
  }, []);

  return { setFilesStaged, stageLines, pendingFiles, pendingLines, whenIdle, queued, reloadToken, diffLoaded };
}
