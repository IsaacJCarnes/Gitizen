import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { BACKGROUND_FETCH_MS, type SyncAction } from "../../hooks/useGitOperations";
import { timeAgo } from "../../utils/format";
import PublishModal from "./PublishModal";

const RUNNING_LABEL: Record<SyncAction, string> = {
  fetch: "Fetching…",
  pull: "Pulling…",
  push: "Pushing…",
};

/**
 * The header's remote buttons, like GitHub Desktop's sync button:
 * "Publish repository" while there is no remote, "Publish branch" for a
 * branch that isn't on the remote yet, otherwise Fetch, Pull and Push with
 * how many commits each would move.
 */
export default function SyncControls(): React.JSX.Element | null {
  const { status, remotes, syncing, sync, needsForcePush, lastFetched } = useGitOperationsContext();
  const [publishing, setPublishing] = useState(false);
  if (!status) return null;

  const busy = syncing !== null;
  const fetchedNote = `${lastFetched ? `Last fetched ${timeAgo(lastFetched)}. ` : ""}Fetched by itself every ${
    BACKGROUND_FETCH_MS / 60_000
  } minutes.`;
  const detached = status.branch === null;
  const button = (action: SyncAction, label: string, title: string, count?: number) => (
    <button
      // Pull and push work on a branch; fetch works anywhere.
      disabled={busy || (detached && action !== "fetch")}
      // A non-zero count makes it the obvious next step.
      className={count ? "primary" : undefined}
      title={detached && action !== "fetch" ? "Check out a branch first" : title}
      onClick={() => void sync(action)}
    >
      {syncing === action ? RUNNING_LABEL[action] : label}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );

  let content: React.JSX.Element;
  if (remotes.length === 0) {
    content = (
      <button
        className="primary"
        disabled={busy}
        title="Create this repository on GitHub, or add an existing remote"
        onClick={() => setPublishing(true)}
      >
        {syncing === "push" ? "Publishing…" : "Publish repository"}
      </button>
    );
  } else if (!status.upstream) {
    content = (
      <>
        {button("fetch", "Fetch", `Download new commits from the remote. ${fetchedNote}`)}
        {button("push", "Publish branch", "Push this branch to the remote and track it")}
      </>
    );
  } else {
    content = (
      <>
        {button("fetch", "Fetch", `Download new commits from ${status.upstream}. ${fetchedNote}`)}
        {button("pull", "Pull ↓", `Pull ${status.upstream} into this branch`, status.behind)}
        {button(
          "push",
          needsForcePush ? "Force push ↑" : "Push ↑",
          needsForcePush
            ? `Replace ${status.upstream} with this branch (refused if someone else pushed since)`
            : `Push this branch to ${status.upstream}`,
          status.ahead,
        )}
      </>
    );
  }

  return (
    <div className="sync-controls">
      {content}
      {publishing && <PublishModal onDismiss={() => setPublishing(false)} />}
    </div>
  );
}
