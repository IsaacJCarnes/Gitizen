import type { GitizenApi } from "../../shared/ipc";

declare global {
  interface Window {
    /** Git API exposed by electron/preload.ts. */
    gitizen: GitizenApi;
  }
}
