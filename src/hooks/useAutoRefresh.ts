import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { REPOSITORY_CHANGED, type RepositoryChanged } from "../../shared/ipc";

/** When the last full and working-state refreshes started, in milliseconds since 1970. */
export interface RefreshTimes {
  full: number;
  working: number;
}

/**
 * Refreshes whenever the watched repository changes on disk (see
 * `watchRepository`), and on coming back to the window. A change during a
 * refresh refreshes once more afterwards, so the last change is never missed.
 *
 * A change to files and the index only (an edit in an editor, staging) needs
 * just `refreshWorking`; anything else (a commit, a checkout) a full
 * `refresh`. `started` says when the latest of each began: a change noticed
 * before then is already shown, so it needs no refresh of its own. That is
 * what keeps each Gitizen action, which refreshes by itself and also changes
 * the repository, from refreshing twice.
 */
export function useAutoRefresh(
  repo: string | null,
  refresh: () => Promise<void>,
  refreshWorking: () => Promise<void>,
  started: React.MutableRefObject<RefreshTimes>,
): void {
  const refreshing = useRef(false);
  // The refresh still owed after the one running now: "full" wins over "working".
  const owed = useRef<"full" | "working" | null>(null);
  useEffect(() => {
    if (!repo) return;
    const refreshSoon = async (kind: "full" | "working"): Promise<void> => {
      owed.current = owed.current === "full" || kind === "full" ? "full" : "working";
      if (refreshing.current) return;
      refreshing.current = true;
      while (owed.current) {
        const next = owed.current;
        owed.current = null;
        await (next === "full" ? refresh() : refreshWorking());
      }
      refreshing.current = false;
    };
    const unlisten = listen<RepositoryChanged>(REPOSITORY_CHANGED, ({ payload }) => {
      const { full, working } = started.current;
      if (payload.workingOnly) {
        if (payload.changedAt >= Math.max(full, working)) void refreshSoon("working");
      } else if (payload.changedAt >= full) {
        void refreshSoon("full");
      }
    });
    const onFocus = (): void => void refreshSoon("full");
    window.addEventListener("focus", onFocus);
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
      window.removeEventListener("focus", onFocus);
    };
  }, [repo, refresh, refreshWorking, started]);
}
