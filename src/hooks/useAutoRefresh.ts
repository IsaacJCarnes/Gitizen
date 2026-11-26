import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { REPOSITORY_CHANGED, type RepositoryChanged } from "../../shared/ipc";

/**
 * Calls `refresh` whenever the watched repository changes on disk (see
 * `watchRepository`), and on coming back to the window. A change during a
 * refresh refreshes once more afterwards, so the last change is never missed.
 *
 * `refreshStarted` is when the latest refresh (of any kind) started. A
 * change noticed before then is already shown, so it needs no refresh of
 * its own: that is what keeps each Gitizen action, which refreshes by
 * itself and also changes the git folder, from refreshing twice.
 */
export function useAutoRefresh(
  repo: string | null,
  refresh: () => Promise<void>,
  refreshStarted: React.MutableRefObject<number>,
): void {
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  useEffect(() => {
    if (!repo) return;
    const refreshSoon = async (): Promise<void> => {
      if (refreshing.current) {
        refreshAgain.current = true;
        return;
      }
      refreshing.current = true;
      do {
        refreshAgain.current = false;
        await refresh();
      } while (refreshAgain.current);
      refreshing.current = false;
    };
    const unlisten = listen<RepositoryChanged>(REPOSITORY_CHANGED, ({ payload }) => {
      if (payload.changedAt >= refreshStarted.current) void refreshSoon();
    });
    const onFocus = (): void => void refreshSoon();
    window.addEventListener("focus", onFocus);
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
      window.removeEventListener("focus", onFocus);
    };
  }, [repo, refresh, refreshStarted]);
}
