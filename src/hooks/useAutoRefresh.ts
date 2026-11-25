import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { REPOSITORY_CHANGED } from "../../shared/ipc";

/**
 * Calls `refresh` whenever the watched repository changes on disk (see
 * `watchRepository`), and on coming back to the window. A change during a
 * refresh refreshes once more afterwards, so the last change is never missed.
 */
export function useAutoRefresh(repo: string | null, refresh: () => Promise<void>): void {
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
    const onChange = (): void => void refreshSoon();
    const unlisten = listen(REPOSITORY_CHANGED, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      void unlisten.then((stop) => stop()).catch(() => {});
      window.removeEventListener("focus", onChange);
    };
  }, [repo, refresh]);
}
