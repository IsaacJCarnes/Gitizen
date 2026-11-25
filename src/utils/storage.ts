/**
 * The webview's localStorage, for small conveniences remembered between
 * runs. It can be disabled or full, so reads fall back to null and failed
 * writes are ignored: the value then only lasts for this session.
 */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience; nothing to do.
  }
}
