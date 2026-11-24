import { useEffect, useState } from "react";
import type { GitCommit } from "../../../shared/gitTypes";
import { gitizen } from "../../api/gitizen";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import { githubCommitPage } from "../../utils/github";
import ActionModal from "../common/ActionModal";
import ConfirmModal from "../common/ConfirmModal";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useBranchMenu } from "../Branches/useBranchMenu";
import { CherryPickDialog, CreateBranchDialog, CreateTagDialog } from "./CommitActionDialogs";
import { DeleteTagDialog, ResetDialog, SquashDialog } from "./HistoryDialogs";
import { commitsAfter, RESET_MODES } from "../../utils/history";
import type { ResetMode } from "../../../shared/gitTypes";
import { pluralize } from "../../utils/format";

/** Rewriting the last commit of a branch. */
type Rewrite = "undo" | "amend";

/**
 * A dialog a menu item opens, which outlives the menu itself: confirming a
 * rewrite of a pushed commit, asking to commit or stash local changes
 * before switching to another branch to rewrite its last commit, or one of
 * the branch, tag and cherry-pick dialogs.
 */
type Dialog =
  | { kind: "confirmPushed"; rewrite: Rewrite }
  | { kind: "needsClean"; rewrite: Rewrite }
  | { kind: "createBranch" | "createTag" | "cherryPick" | "squash" }
  | { kind: "reset"; mode: ResetMode }
  | { kind: "deleteTag"; tag: string };

interface CommitContextMenuProps {
  commit: GitCommit;
  /** Where the right-click happened, in viewport pixels. */
  x: number;
  y: number;
  /** Called once the menu and any dialog it opened are closed. */
  onClose: () => void;
}

/**
 * The right-click menu of a commit in the history: check it out (or a
 * branch at it), start a branch or tag there, cherry-pick it onto a branch,
 * copy its hash or open it on GitHub. On the last commit of a branch it
 * also offers undo and amend: on the current branch directly, on
 * another branch by switching to it first (asking to commit or stash local
 * changes before that). Rewriting a commit that is already on a remote asks
 * first, since it then has to be force-pushed.
 *
 * A commit that is the head of local branches also gets each branch's own
 * controls (rename, delete, merge and so on): inline for one branch, or a
 * submenu per branch name when several point at the commit.
 *
 * It can also revert any commit, reset the current branch back to it, push
 * or delete the tags on it, and, with several commits selected, squash
 * them. Squashing only works on the current branch's own commits (see
 * `rewritable`), so no other branch, tag or remote is left with history
 * that was rewritten under it.
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
    remotes,
    checkoutBranch,
    checkoutCommit,
    reportError,
    commits,
    conflicts,
    selectedCommits,
    rewritable,
    revertCommit,
    pushTag,
  } = useGitOperationsContext();
  const [menuOpen, setMenuOpen] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { branchEntries, branchDialog, dialogOpen: branchDialogOpen } = useBranchMenu();

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

  const localBranches = commit.refs.filter((ref) => ref.type === "branch" && !ref.current);
  const busy = conflicts.operation !== null ? "Finish or abort the operation in progress first" : undefined;
  const detached = status?.branch ? undefined : "Check out a branch first";

  // Squashing the selection: commits next to each other among the
  // branch's own, unshared ones.
  const squashing = selectedCommits.length > 1 && selectedCommits.some((each) => each.hash === commit.hash);
  const positions = selectedCommits.map((each) => rewritable.indexOf(each.hash)).sort((a, b) => a - b);
  const squashBlocked =
    busy ??
    detached ??
    (positions[0] === -1
      ? `Only ${status?.branch}'s own commits can be squashed: not merges, and not commits that are pushed or that another branch or tag also has`
      : positions[positions.length - 1] - positions[0] + 1 !== positions.length
        ? "Select commits that are next to each other"
        : undefined);

  // Resetting the current branch back to this commit, an earlier one of it.
  const after = commitsAfter(commits, commit.hash);
  const resetBlocked =
    busy ??
    detached ??
    (after === null
      ? "Only commits on the current branch's line can be reset to"
      : after.length === 0
        ? "The branch is already at this commit"
        : undefined);
  const tags = commit.refs.filter((ref) => ref.type === "tag").map((ref) => ref.name);
  const githubPage = githubCommitPage(remotes, status?.upstream, commit.hash);

  const entries: MenuEntry[] = [
    // A branch pointing here is usually what's wanted; the bare commit
    // (detached HEAD) is offered too.
    ...localBranches.map((ref) => ({
      label: `Checkout ${ref.name}`,
      onSelect: () => void checkoutBranch(ref.name),
    })),
    {
      label: "Checkout commit",
      disabled: isHead,
      title: isHead
        ? "This commit is already checked out"
        : "Check out this commit itself (detached HEAD), e.g. to look around or test it",
      onSelect: () => void checkoutCommit(commit.hash),
    },
    { label: "Create branch from commit…", onSelect: () => setDialog({ kind: "createBranch" }) },
    { label: "Create tag…", onSelect: () => setDialog({ kind: "createTag" }) },
    {
      label: "Cherry-pick to branch…",
      disabled: isMerge,
      title: isMerge ? "Merge commits can't be cherry-picked here" : undefined,
      onSelect: () => setDialog({ kind: "cherryPick" }),
    },
    {
      label: "Revert commit",
      disabled: Boolean(busy ?? detached),
      title: busy ?? detached ?? `Add a commit to ${status?.branch} that undoes this one`,
      onSelect: () => void revertCommit(commit.hash),
    },
    {
      label: `Reset ${status?.branch ?? "branch"} to this commit`,
      disabled: Boolean(resetBlocked),
      title: resetBlocked,
      submenu: (["soft", "mixed", "hard"] as const).map((mode) => ({
        label: `${RESET_MODES[mode].label}…`,
        title: `Move ${status?.branch} back here; ${RESET_MODES[mode].keeps}`,
        onSelect: () => setDialog({ kind: "reset", mode }),
      })),
    },
  ];
  if (squashing) {
    entries.unshift(
      {
        label: `Squash ${pluralize(selectedCommits.length, "commit")}…`,
        disabled: Boolean(squashBlocked),
        title: squashBlocked ?? "Make the selected commits one commit",
        onSelect: () => setDialog({ kind: "squash" }),
      },
      "separator",
    );
  }
  if (tags.length > 0) {
    const noRemote = remotes.length === 0 ? "This repository has no remote" : undefined;
    entries.push(
      "separator",
      ...tags.map((tag): MenuEntry => ({
        label: `Tag ${tag}`,
        submenu: [
          {
            label: "Push tag",
            disabled: Boolean(noRemote),
            title: noRemote,
            onSelect: () => void pushTag(tag),
          },
          { label: "Delete tag…", onSelect: () => setDialog({ kind: "deleteTag", tag }) },
        ],
      })),
    );
  }
  const heads = commit.refs.filter((ref) => ref.type === "branch").map((ref) => ref.name);
  if (heads.length === 1) entries.push("separator", ...branchEntries(heads[0]));
  else if (heads.length > 1) {
    entries.push("separator", ...heads.map((name) => ({ label: name, submenu: branchEntries(name) })));
  }
  if (isHead || otherBranch) {
    const on = otherBranch ? ` on ${otherBranch}` : "";
    entries.push(
      "separator",
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
  entries.push(
    "separator",
    {
      label: "Copy SHA",
      onSelect: () => void navigator.clipboard.writeText(commit.hash).catch(reportError),
    },
    {
      label: "View on GitHub",
      disabled: !githubPage,
      title: githubPage ? githubPage : "This repository has no github.com remote",
      onSelect: () => githubPage && void gitizen.openInBrowser(githubPage).catch(reportError),
    },
  );

  // Choosing an item closes the menu and may open a dialog in the same
  // (batched) update, so only report closed once neither is showing.
  useEffect(() => {
    if (!menuOpen && !dialog && !branchDialogOpen) onClose();
  }, [menuOpen, dialog, branchDialogOpen, onClose]);

  const closeDialog = (): void => setDialog(null);

  return (
    <>
      {menuOpen && (
        <ContextMenu x={x} y={y} entries={entries} onClose={() => setMenuOpen(false)} />
      )}
      {dialog?.kind === "confirmPushed" && (
        <ConfirmModal
          title={dialog.rewrite === "undo" ? "Undo a pushed commit?" : "Amend a pushed commit?"}
          confirmLabel={dialog.rewrite === "undo" ? "Undo commit" : "Amend commit"}
          onConfirm={() => runWhenClean(dialog.rewrite, true)}
          onDismiss={closeDialog}
        >
          <p>
            This commit is already on the remote. Changing it rewrites history, so Push becomes a
            force push afterwards, and anyone who pulled the commit will have to reconcile.
          </p>
        </ConfirmModal>
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
            A stash keeps the changes aside without committing them. Bring them back later with
            Pop, in the Stash section of the sidebar on {status?.branch ?? "this branch"}.
          </p>
        </ActionModal>
      )}
      {dialog?.kind === "createBranch" && <CreateBranchDialog commit={commit} onDismiss={closeDialog} />}
      {dialog?.kind === "createTag" && <CreateTagDialog commit={commit} onDismiss={closeDialog} />}
      {dialog?.kind === "cherryPick" && <CherryPickDialog commit={commit} onDismiss={closeDialog} />}
      {dialog?.kind === "squash" && <SquashDialog commits={selectedCommits} onDismiss={closeDialog} />}
      {dialog?.kind === "reset" && <ResetDialog commit={commit} mode={dialog.mode} onDismiss={closeDialog} />}
      {dialog?.kind === "deleteTag" && <DeleteTagDialog tag={dialog.tag} onDismiss={closeDialog} />}
      {branchDialog}
    </>
  );
}
