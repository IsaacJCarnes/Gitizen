import { useCallback, useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "../utils/storage";

/** "unified" shows one column; "split" shows removed lines beside added ones. */
export type DiffLayout = "unified" | "split";

/** How diffs are shown. Saved in the webview's localStorage. */
export interface DiffSettings {
  layout: DiffLayout;
  /** Hide changes that only add, remove or change whitespace (`git diff -w`). */
  hideWhitespace: boolean;
}

const STORAGE_KEY = "gitizen.diffSettings";
const DEFAULTS: DiffSettings = { layout: "unified", hideWhitespace: false };

/** Reads the saved settings, falling back to the defaults for anything missing or invalid. */
function load(): DiffSettings {
  try {
    const saved: unknown = JSON.parse(readStorage(STORAGE_KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return DEFAULTS;
    const { layout, hideWhitespace } = saved as Record<string, unknown>;
    return {
      layout: layout === "split" ? "split" : "unified",
      hideWhitespace: hideWhitespace === true,
    };
  } catch {
    return DEFAULTS;
  }
}

// One shared copy, so every component using the hook sees a change at once.
let current = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DiffSettings {
  return current;
}

/** The diff settings, and a function that changes some of them and saves the result. */
export function useDiffSettings(): {
  settings: DiffSettings;
  updateSettings: (change: Partial<DiffSettings>) => void;
} {
  const settings = useSyncExternalStore(subscribe, getSnapshot);
  const updateSettings = useCallback((change: Partial<DiffSettings>): void => {
    current = { ...current, ...change };
    writeStorage(STORAGE_KEY, JSON.stringify(current));
    listeners.forEach((listener) => listener());
  }, []);
  return { settings, updateSettings };
}
