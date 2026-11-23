import "./CommitHistory.css";
import { useMemo, useState } from "react";
import { useAppContext } from "../../context/AppContext";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { GitCommit } from "../../../shared/gitTypes";
import { buildCommitGraph, laneColor, type GraphNode } from "../../utils/commitGraph";
import { pluralize, shortHash } from "../../utils/format";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import CommitContextMenu from "./CommitContextMenu";
import CommitGraphCell, { LANE_WIDTH } from "./CommitGraphCell";
import RefBadge from "./RefBadge";

/** Graph key for the branch's stash row, drawn as its own node. */
const STASH = "stash" as const;

/** Graph key for the "Uncommitted changes" row, which has no real hash. */
const PENDING = "pending";

/** Refs treated as the trunk, best first: local main, then master, then origin's. */
const TRUNK_REFS = [
  { type: "branch", name: "main" },
  { type: "branch", name: "master" },
  { type: "remote", name: "origin/main" },
  { type: "remote", name: "origin/master" },
] as const;

/** Hash of the main branch tip, which the graph keeps in the first lane. */
function findTrunk(commits: GitCommit[]): string | undefined {
  for (const { type, name } of TRUNK_REFS) {
    const match = commits.find((commit) =>
      commit.refs.some((ref) => ref.type === type && ref.name === name),
    );
    if (match) return match.hash;
  }
  return undefined;
}

/**
 * The commit history as a graph across all branches. When the working tree
 * has changes, an "Uncommitted changes" row sits on top, attached to HEAD.
 * Clicking a row selects it; the sidebar then shows that row's files.
 * Right-clicking a commit opens its menu (undo, amend and so on);
 * right-clicking "Uncommitted changes" offers to stash or discard them all,
 * and right-clicking the stash offers to pop or discard it.
 *
 * The branch's stash is a node of its own, attached to the commit it was
 * made on, in the next lane over (beside the uncommitted changes when
 * there are both). Clicking it shows its first file's changes.
 */
export default function CommitHistory(): React.JSX.Element {
  const {
    commits,
    status,
    selectedCommit,
    selectCommit,
    branchStash,
    stashChanges,
    conflicts,
    selectStashFile,
    stashSelected,
    selectStash,
    popStash,
    dropStash,
    discardFiles,
  } = useGitOperationsContext();
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const [stashMenu, setStashMenu] = useState<{ x: number; y: number } | null>(null);
  const { setView } = useAppContext();
  const [menu, setMenu] = useState<{ commit: GitCommit; x: number; y: number } | null>(null);
  const [pendingMenu, setPendingMenu] = useState<{ x: number; y: number } | null>(null);
  const changeCount = status?.files.length ?? 0;
  const hasPending = changeCount > 0;
  const stashBase = branchStash?.base;

  const graph = useMemo(() => {
    const nodes: GraphNode[] = commits.map(({ hash, parents }) => ({ hash, parents }));
    let trunk = findTrunk(commits);
    if (hasPending) {
      const head = commits.find((commit) => commit.refs.some((ref) => ref.current));
      nodes.unshift({ hash: PENDING, parents: head ? [head.hash] : [], dashed: true });
      // Changes on top of main stay in main's lane.
      if (head && head.hash === trunk) trunk = PENDING;
    }
    if (stashBase) {
      // After the uncommitted changes, so it takes the next lane over.
      nodes.splice(hasPending ? 1 : 0, 0, { hash: STASH, parents: [stashBase], dashed: true });
    }
    return buildCommitGraph(nodes, trunk);
  }, [commits, hasPending, stashBase]);

  const width = graph.laneCount * LANE_WIDTH;
  // null stands for the "Uncommitted changes" row and STASH for the stash's.
  const rows: (GitCommit | null | typeof STASH)[] = [
    ...(hasPending ? [null] : []),
    ...(stashBase ? [STASH] : []),
    ...commits,
  ];

  const select = (commit: GitCommit | null): void => {
    if (commit?.hash !== selectedCommit?.hash || stashSelected) selectCommit(commit);
  };

  // Popping or dropping needs nothing else in progress.
  const stashBusy = conflicts.operation !== null;
  const stashEntries: MenuEntry[] = [
    {
      label: "Pop stash",
      disabled: stashBusy,
      title: stashBusy
        ? "Finish or abort the operation in progress first"
        : "Bring the stashed changes back to the working directory and remove the stash",
      onSelect: () => void popStash(),
    },
    {
      label: "Discard stash…",
      disabled: stashBusy,
      title: stashBusy ? "Finish or abort the operation in progress first" : "Delete the stash for good",
      onSelect: () =>
        confirmDiscard({
          title: "Discard the stash?",
          what: (
            <>
              The stash on <code>{status?.branch ?? "this branch"}</code> (
              {pluralize(branchStash?.files.length ?? 0, "file")})
            </>
          ),
          confirmLabel: "Discard stash",
          run: () => void dropStash(),
        }),
    },
  ];

  /** Shows the working tree, with the stash's first file open. */
  const openStash = (): void => {
    selectStash();
    const first = branchStash?.files[0];
    if (first) {
      selectStashFile(first);
      setView("diff");
    }
  };

  if (rows.length === 0) {
    return <p className="placeholder">No commits yet.</p>;
  }

  return (
    <>
      <ol className="commit-graph">
        {rows.map((entry, index) => {
          const row = graph.rows[index];
          const color = laneColor(row.lane);
          if (entry === STASH) {
            return (
              <li key={STASH} className={`pending stash${stashSelected ? " on" : ""}`}>
                <button
                  onClick={openStash}
                  title="Show the stash's changes"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setStashMenu({ x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="refs" />
                  <CommitGraphCell row={row} width={width} pending />
                  <span className="info">
                    <b>Stash</b>
                    <small>
                      {branchStash?.message} · {pluralize(branchStash?.files.length ?? 0, "file")}
                    </small>
                  </span>
                </button>
              </li>
            );
          }
          const commit = entry;
          const selected = commit
            ? selectedCommit?.hash === commit.hash
            : !selectedCommit && !stashSelected;

          return (
            <li
              key={commit?.hash ?? PENDING}
              className={`${commit ? "" : "pending"}${selected ? " on" : ""}`}
            >
              <button
                onClick={() => select(commit)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (commit) setMenu({ commit, x: event.clientX, y: event.clientY });
                  else setPendingMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                <span
                  className="refs"
                  title={commit?.refs.map((ref) => ref.name).join(", ")}
                >
                  {commit?.refs.map((ref) => (
                    <RefBadge key={`${ref.type}:${ref.name}`} gitRef={ref} color={color} />
                  ))}
                </span>
                <CommitGraphCell row={row} width={width} pending={!commit} />
                <span className="info">
                  {commit ? (
                    <>
                      <b>{commit.message}</b>
                      <small>
                        {commit.author} · {shortHash(commit.hash)} ·{" "}
                        {new Date(commit.date).toLocaleDateString()}
                      </small>
                    </>
                  ) : (
                    <>
                      <b>Uncommitted changes</b>
                      <small>{pluralize(changeCount, "changed file")}</small>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {menu && <CommitContextMenu {...menu} onClose={() => setMenu(null)} />}
      {pendingMenu && (
        <ContextMenu
          x={pendingMenu.x}
          y={pendingMenu.y}
          onClose={() => setPendingMenu(null)}
          entries={[
            {
              // A branch keeps one stash, so this adds to it when there is one.
              label: branchStash ? "Add all changes to stash" : "Stash all changes",
              disabled: conflicts.operation !== null || status?.branch === null,
              title:
                conflicts.operation !== null
                  ? "Finish or abort the operation in progress first"
                  : status?.branch === null
                    ? "Check out a branch to stash changes on it"
                    : `Set every change aside in the stash on ${status?.branch}`,
              onSelect: () => void stashChanges(""),
            },
            "separator",
            {
              label: "Discard all changes…",
              disabled: conflicts.operation !== null,
              title:
                conflicts.operation !== null
                  ? "Finish or abort the operation in progress first"
                  : "Put every file back as it was in the last commit",
              onSelect: () =>
                confirmDiscard({
                  title: "Discard all changes?",
                  what: <>Every uncommitted change ({pluralize(changeCount, "file")}), staged or not,</>,
                  confirmLabel: "Discard all changes",
                  // Both paths of a rename, so the old file comes back too.
                  run: () =>
                    void discardFiles(
                      (status?.files ?? []).flatMap((file) =>
                        file.oldPath ? [file.path, file.oldPath] : [file.path],
                      ),
                    ),
                }),
            },
          ]}
        />
      )}
      {stashMenu && branchStash && (
        <ContextMenu
          x={stashMenu.x}
          y={stashMenu.y}
          onClose={() => setStashMenu(null)}
          entries={stashEntries}
        />
      )}
      {discardDialog}
    </>
  );
}
