import { useCallback, useEffect, useRef, useState } from "react";
import { gitizen } from "../api/gitizen";
import type { GitOperations } from "./useGitOperations";

/** A network operation the header's sync buttons can run. */
export type SyncAction = "fetch" | "pull" | "push";

/** How often the open repository is fetched in the background. */
export const BACKGROUND_FETCH_MS = 5 * 60 * 1000;

interface SyncOptions {
  /** The open repository, or null. */
  repo: string | null;
  /** Whether it has remotes; only then is it fetched in the background. */
  hasRemotes: boolean;
  /** `useGitOperations`' runner: runs a call, refreshes, and shows failures. */
  runOperation: (operation: () => Promise<unknown>) => Promise<boolean>;
  refresh: () => Promise<void>;
}

type SyncState = Pick<GitOperations, "syncing" | "sync" | "lastFetched" | "needsForcePush" | "publishRepository"> & {
  setNeedsForcePush: (needed: boolean) => void;
  /** Forgets the previous repository's sync state, when another one opens. */
  resetSync: () => void;
};

/**
 * Fetch, pull, push and publish for the open repository, one at a time,
 * plus a quiet fetch in the background every few minutes. Part of
 * `useGitOperations`, which documents the fields it returns.
 */
export function useSync({ repo, hasRemotes, runOperation, refresh }: SyncOptions): SyncState {
  const [syncing, setSyncing] = useState<SyncAction | null>(null);
  // Read by the background fetch, which mustn't run alongside a sync.
  const syncingRef = useRef(syncing);
  syncingRef.current = syncing;
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const lastFetchedRef = useRef(0);
  // The background fetch while it runs; a sync waits for it first.
  const backgroundFetch = useRef<Promise<void> | null>(null);
  const [needsForcePush, setNeedsForcePush] = useState(false);

  /** Forgets the previous repository's state; a newly opened one is fetched in the background right away. */
  const resetSync = useCallback((): void => {
    lastFetchedRef.current = 0;
    setLastFetched(null);
    setNeedsForcePush(false);
  }, []);

  /** Notes a successful fetch. */
  const fetched = useCallback((): void => {
    lastFetchedRef.current = Date.now();
    setLastFetched(lastFetchedRef.current);
  }, []);

  /** Shows `action` as running in the header while `work` runs. */
  const showing = useCallback(async (action: SyncAction, work: () => Promise<boolean>): Promise<boolean> => {
    setSyncing(action);
    const ok = await work();
    setSyncing(null);
    return ok;
  }, []);

  const sync = useCallback(
    (action: SyncAction): Promise<boolean> =>
      showing(action, async () => {
        // Two git network commands at once could trip over each other's locks.
        await backgroundFetch.current;
        const run = {
          fetch: async () => {
            await gitizen.fetch();
            fetched();
          },
          pull: gitizen.pull,
          push: async () => {
            await gitizen.push(needsForcePush);
            setNeedsForcePush(false);
          },
        }[action];
        return runOperation(run);
      }),
    [showing, runOperation, needsForcePush, fetched],
  );

  // Publishing pushes, so the header shows it like a push meanwhile.
  const publishRepository = useCallback(
    (name: string, description: string, isPrivate: boolean): Promise<boolean> =>
      showing("push", () => runOperation(() => gitizen.publishRepository(name, description, isPrivate))),
    [showing, runOperation],
  );

  /**
   * Fetches quietly, then refreshes the ahead/behind counts. Failures (no
   * network, not signed in) are ignored; the next round tries again.
   */
  const fetchInBackground = useCallback((): void => {
    if (backgroundFetch.current || syncingRef.current) return;
    // Counts as fetched even on failure, so an offline repository isn't retried every minute.
    lastFetchedRef.current = Date.now();
    backgroundFetch.current = gitizen
      .fetch(true)
      .then(async () => {
        fetched();
        await refresh();
      })
      .catch(() => {})
      .finally(() => {
        backgroundFetch.current = null;
      });
  }, [fetched, refresh]);

  // Fetch in the background when a repository with remotes opens, then
  // every few minutes, and on coming back to the window once that is due.
  useEffect(() => {
    if (!repo || !hasRemotes) return;
    const fetchIfDue = (): void => {
      if (Date.now() - lastFetchedRef.current >= BACKGROUND_FETCH_MS) fetchInBackground();
    };
    fetchIfDue();
    const timer = window.setInterval(fetchIfDue, 30_000);
    window.addEventListener("focus", fetchIfDue);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", fetchIfDue);
    };
  }, [repo, hasRemotes, fetchInBackground]);

  return { syncing, sync, lastFetched, needsForcePush, setNeedsForcePush, publishRepository, resetSync };
}
