import { useEffect, useState } from "react";
import type { GitCommit } from "../../../shared/gitTypes";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import ActionModal from "../common/ActionModal";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";

/** Rewriting the last commit of a branch. */
type Rewrite = "undo" | "amend";

/**
 * A dialog a menu item opens, which outlives the menu itself: confirming a
 * rewrite of a pushed commit, or asking to commit or stash local changes
 * before switching to another branch to rewrite its last commit.
 */
type Dialog = { kind: "confirmPushed"; rewrite: Rewrite } | { kind: "needsClean"; rewrite: Rewrite };

interface CommitContextMenuProps {
  commit: GitCommit;
  /** Where the right-click happened, in viewport pixels. */
  x: number;
  y: number;
  /** Called once the menu and any dialog it opened are closed. */
  onClose: () => void;
}

/**
 * The right-click menu of a commit in the history. On the last commit of a
 * branch it offers undo and amend: on the current branch directly, on
 * another branch by switching to it first (asking to commit or stash local
 * changes before that). Rewriting a commit that is already on a remote asks
 * first, since it then has to be force-pushed.
 */
export default function CommitContextMenu({
  commit,
  x,
  y,
  onClose,
}: CommitContextMenuProps): React.JSX.Element | null {
  const {
    status,
    startAmend,
    undoLastCommit,
    markPushedCommitRewritten,
    stashChanges,
    selectCommit,
  } = useGitOperationsContext();
  const [menuOpen, setMenuOpen] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const isHead = commit.refs.some((ref) => ref.current);
  const isMerge = commit.parents.length > 1;
  // On a remote if a remote branch points at it, or the branch it is the tip
  // of tracks an upstream it isn't ahead of.
  const isPushed =
    commit.refs.some((ref) => ref.type === "remote") ||
    (isHead && Boolean(status?.upstream) && status?.ahead === 0);

  // The branch to switch to when this is the tip of a branch that isn't
  // checked out (the first one, if several point here).
  const otherBranch = isHead
    ? undefined
    : commit.refs.find((ref) => ref.type === "branch" && !ref.current)?.name;
  const hasChanges = (status?.files.length ?? 0) > 0;

  /** Runs the rewrite, switching to `otherBranch` first when set. */
  const run = (rewrite: Rewrite, pushed: boolean): void => {
    setDialog(null);
    if (pushed) markPushedCommitRewritten();
    if (rewrite === "undo") void undoLastCommit(commit, otherBranch);
    else void startAmend(commit, otherBranch);
  };

  /** Switching branches needs a clean working tree; ask first if it isn't. */
  const runWhenClean = (rewrite: Rewrite, pushed: boolean): void => {
    if (otherBranch && hasChanges) setDialog({ kind: "needsClean", rewrite });
    else run(rewrite, pushed);
  };

  const choose = (rewrite: Rewrite): void => {
    if (isPushed) setDialog({ kind: "confirmPushed", rewrite });
    else runWhenClean(rewrite, false);
  };

  const entries: MenuEntry[] = [];
  if (isHead || otherBranch) {
    const on = otherBranch ? ` on ${otherBranch}` : "";
    entries.push(
      {
        label: `Amend commit${on}…`,
        title: otherBranch ? `Switch to ${otherBranch} and amend its last commit` : undefined,
        onSelect: () => choose("amend"),
      },
      {
        label: `Undo commit${on}`,
        disabled: isMerge,
        title: isMerge
          ? "Merge commits can't be undone here"
          : otherBranch
            ? `Switch to ${otherBranch} and undo its last commit, keeping its changes staged`
            : "Undo it and keep its changes staged",
        onSelect: () => choose("undo"),
      },
    );
  }

  // Choosing an item closes the menu and may open a dialog in the same
  // (batched) update, so only report closed once neither is showing. A
  // commit with nothing to offer closes straight away.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if ((!menuOpen || !hasEntries) && !dialog) onClose();
  }, [menuOpen, hasEntries, dialog, onClose]);

  const closeDialog = (): void => setDialog(null);
  const pushedWarning = (
    <p>
      This commit is already on the remote. Changing it rewrites history, so Push becomes a
      force push afterwards, and anyone who pulled the commit will have to reconcile.
    </p>
  );

  return (
    <>
      {menuOpen && hasEntries && (
        <ContextMenu x={x} y={y} entries={entries} onClose={() => setMenuOpen(false)} />
      )}
      {dialog?.kind === "confirmPushed" && (
        <ActionModal
          title={dialog.rewrite === "undo" ? "Undo a pushed commit?" : "Amend a pushed commit?"}
          onDismiss={closeDialog}
          actions={[
            {
              label: dialog.rewrite === "undo" ? "Undo commit" : "Amend commit",
              primary: true,
              onClick: () => runWhenClean(dialog.rewrite, true),
            },
          ]}
        >
          {pushedWarning}
        </ActionModal>
      )}
      {dialog?.kind === "needsClean" && otherBranch && (
        <ActionModal
          title={`Switch to ${otherBranch}?`}
          onDismiss={closeDialog}
          actions={[
            {
              // Back to the commit form, to commit the changes on this branch.
              label: "Commit them first",
              onClick: () => {
                closeDialog();
                selectCommit(null);
              },
            },
            {
              label: "Stash and continue",
              primary: true,
              onClick: () => {
                const { rewrite } = dialog;
                closeDialog();
                void stashChanges(
                  `Gitizen: before ${rewrite === "undo" ? "undoing" : "amending"} the last commit on ${otherBranch}`,
                ).then((stashed) => {
                  // A failed stash shows its error; don't switch then.
                  if (stashed) run(rewrite, isPushed);
                });
              },
            },
          ]}
        >
          <p>
            To {dialog.rewrite === "undo" ? "undo" : "amend"} the last commit on {otherBranch},
            Gitizen switches to that branch, which needs your uncommitted changes out of the way
            first. Commit them on {status?.branch ?? "the current commit"}, or stash them.
          </p>
          <p>
            A stash keeps the changes aside without committing them. Bring them back later with{" "}
            <code>git stash pop</code> on the branch you want them on.
          </p>
        </ActionModal>
      )}
    </>
  );
}
