import { useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { BACKGROUND_FETCH_MS, type SyncAction } from "../../hooks/useGitOperations";
import { timeAgo } from "../../utils/format";
import ActionModal from "../common/ActionModal";
import PublishModal from "./PublishModal";
import { publishWarning, pushRemote } from "./publishTarget";

const RUNNING_LABEL: Record<SyncAction, string> = {
  fetch: "Fetching…",
  pull: "Pulling…",
  push: "Pushing…",
};

/**
 * The header's remote buttons, like GitHub Desktop's sync button:
 * "Publish repository" while there is no remote (no Fetch, since there is
 * nothing to fetch from), "Publish branch" for a branch that isn't on the
 * remote yet, otherwise Fetch, Pull and Push with how many commits each
 * would move. With several remotes and none named origin, a new branch has
 * nowhere obvious to go, so "Connect origin" offers to add one.
 *
 * Publishing a branch other than main to a remote that has no branches yet
 * asks first, since that branch would become the remote's default branch.
 */
export default function SyncControls(): React.JSX.Element | null {
  const { status, remotes, branches, commits, syncing, sync, needsForcePush, checkoutBranch, lastFetched } =
    useGitOperationsContext();
  const [publishing, setPublishing] = useState<"github" | "existing" | null>(null);
  const [warnTrunk, setWarnTrunk] = useState<string | null>(null);
  if (!status) return null;

  const busy = syncing !== null;
  const fetchedNote = `${lastFetched ? `Last fetched ${timeAgo(lastFetched)}. ` : ""}Fetched by itself every ${
    BACKGROUND_FETCH_MS / 60_000
  } minutes.`;
  const detached = status.branch === null;
  const button = (
    action: SyncAction,
    label: string,
    title: string,
    count?: number,
    onClick: () => void = () => void sync(action),
  ) => (
    <button
      // Pull and push work on a branch; fetch works anywhere.
      disabled={busy || (detached && action !== "fetch")}
      // A non-zero count makes it the obvious next step.
      className={count ? "primary" : undefined}
      title={detached && action !== "fetch" ? "Check out a branch first" : title}
      onClick={onClick}
    >
      {syncing === action ? RUNNING_LABEL[action] : label}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );

  const target = pushRemote(remotes);
  const publishBranch = (): void => {
    const trunk = publishWarning(status.branch, branches, target, commits);
    if (trunk) setWarnTrunk(trunk);
    else void sync("push");
  };

  let content: React.JSX.Element;
  if (remotes.length === 0) {
    content = (
      <button
        className="primary"
        disabled={busy}
        title="Create this repository on GitHub, or connect it to an existing origin"
        onClick={() => setPublishing("github")}
      >
        {syncing === "push" ? "Publishing…" : "Publish repository"}
      </button>
    );
  } else if (!status.upstream) {
    content = (
      <>
        {button("fetch", "Fetch", `Download new commits from the remote. ${fetchedNote}`)}
        {target ? (
          button("push", "Publish branch", `Push this branch to ${target} and track it`, undefined, publishBranch)
        ) : (
          <button
            className="primary"
            disabled={busy}
            title="There are several remotes and none is called origin. Add an origin to publish branches to."
            onClick={() => setPublishing("existing")}
          >
            Connect origin
          </button>
        )}
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
      {publishing && <PublishModal initialMode={publishing} onDismiss={() => setPublishing(null)} />}
      {warnTrunk && (
        <ActionModal
          title={`Publish ${status.branch} instead of ${warnTrunk}?`}
          onDismiss={() => setWarnTrunk(null)}
          actions={[
            {
              label: `Switch to ${warnTrunk}`,
              primary: true,
              onClick: () => {
                setWarnTrunk(null);
                void checkoutBranch(warnTrunk);
              },
            },
            {
              label: `Publish ${status.branch} anyway`,
              onClick: () => {
                setWarnTrunk(null);
                void sync("push");
              },
            },
          ]}
        >
          <p>
            <code>{target}</code> has no branches yet, so the first branch published becomes its
            default branch. You are on <code>{status.branch}</code>, not <code>{warnTrunk}</code>.
          </p>
          <p>Switch to {warnTrunk} and publish that first, unless {status.branch} should be the default.</p>
        </ActionModal>
      )}
    </div>
  );
}
