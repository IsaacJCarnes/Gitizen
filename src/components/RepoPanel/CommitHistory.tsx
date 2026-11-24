import "./CommitHistory.css";
import { useMemo, useState } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { GitCommit } from "../../../shared/gitTypes";
import { buildCommitGraph, laneColor, type GraphNode } from "../../utils/commitGraph";
import { useContextMenu } from "../../hooks/useContextMenu";
import { pluralize, renamePaths, shortHash } from "../../utils/format";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import { discardStashRequest, OPERATION_IN_PROGRESS, POP_TITLE, stashItem } from "../Stash/stashMenu";
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
 * Ctrl+click adds or removes commits and Shift+click selects a range;
 * several commits show their changes together. The branch's own commits
 * (see `rewritable`) can be dragged up or down to reorder them.
 * Right-clicking a commit opens its menu (undo, amend and so on);
 * right-clicking "Uncommitted changes" offers to stash or discard them all,
 * and right-clicking the stash offers to pop or discard it.
 *
 * The branch's stash is a node of its own, attached to the commit it was
 * made on, in the next lane over (beside the uncommitted changes when
 * there are both). Clicking it shows its first file's changes.
 */
export default function CommitHistory(): React.JSX.Element {
  const git = useGitOperationsContext();
  const {
    commits,
    status,
    selectedCommit,
    selectedCommits,
    selectCommit,
    branchStash,
    conflicts,
    stashSelected,
    selectStash,
    popStash,
    discardFiles,
    rewritable,
    reorderCommits,
  } = git;
  // Dragging a commit to reorder: the one dragged, and where it would land
  // (above or below another of the branch's own commits).
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ hash: string; below: boolean } | null>(null);
  // Only the branch's own commits move, and not in the middle of an operation.
  const movable = (hash: string): boolean => conflicts.operation === null && rewritable.includes(hash);
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  // A commit's menu, or the "Uncommitted changes" row's (null) or the stash's.
  const { menu, openMenu, closeMenu } = useContextMenu<GitCommit | null | typeof STASH>();
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

  const selectedHashes = new Set(selectedCommits.map((commit) => commit.hash));

  /** A click: Ctrl (or Cmd) adds or removes a commit, Shift selects a range. */
  const select = (commit: GitCommit | null, event: React.MouseEvent): void => {
    if (commit && (event.ctrlKey || event.metaKey)) return selectCommit(commit, "toggle");
    if (commit && event.shiftKey) return selectCommit(commit, "range");
    const already = commit ? selectedCommits.length === 1 && selectedCommit?.hash === commit.hash : !selectedCommit;
    if (!already || stashSelected) selectCommit(commit);
  };

  // Popping, dropping or discarding needs nothing else in progress.
  const busy = conflicts.operation !== null ? OPERATION_IN_PROGRESS : undefined;
  const stashEntries: MenuEntry[] = [
    {
      label: "Pop stash",
      disabled: Boolean(busy),
      title: busy ?? POP_TITLE,
      onSelect: () => void popStash(),
    },
    {
      label: "Discard stash…",
      disabled: Boolean(busy),
      title: busy ?? "Delete the stash for good",
      onSelect: () => confirmDiscard(discardStashRequest(git)),
    },
  ];
  const pendingEntries: MenuEntry[] = [
    stashItem(git, [], "all changes"),
    "separator",
    {
      label: "Discard all changes…",
      disabled: Boolean(busy),
      title: busy ?? "Put every file back as it was in the last commit",
      onSelect: () =>
        confirmDiscard({
          title: "Discard all changes?",
          what: <>Every uncommitted change ({pluralize(changeCount, "file")}), staged or not,</>,
          confirmLabel: "Discard all changes",
          run: () => void discardFiles((status?.files ?? []).flatMap(renamePaths)),
        }),
    },
  ];

  /** Drops the dragged commit above or below `target`, replaying the commits that change place. */
  const drop = (target: string, below: boolean): void => {
    setDragged(null);
    setDropAt(null);
    if (!dragged || dragged === target) return;
    // Newest first, like the history.
    const moved = rewritable.filter((hash) => hash !== dragged);
    moved.splice(moved.indexOf(target) + (below ? 1 : 0), 0, dragged);
    // Everything from the deepest commit that changed place up to the tip is replayed.
    let deepest = -1;
    moved.forEach((hash, index) => {
      if (hash !== rewritable[index]) deepest = index;
    });
    if (deepest >= 0) void reorderCommits(moved.slice(0, deepest + 1).reverse());
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
                  onClick={selectStash}
                  title="Show the stash's changes"
                  onContextMenu={(event) => openMenu(event, STASH)}
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
          const selected = commit ? selectedHashes.has(commit.hash) : !selectedCommit && !stashSelected;
          const canMove = commit !== null && movable(commit.hash);
          const dropClass =
            dragged && commit && dropAt?.hash === commit.hash ? (dropAt.below ? " drop-below" : " drop-above") : "";

          return (
            <li
              key={commit?.hash ?? PENDING}
              className={`${commit ? "" : "pending"}${selected ? " on" : ""}${canMove ? " movable" : ""}${dropClass}`}
              draggable={canMove}
              title={canMove ? "Drag to reorder this branch's commits" : undefined}
              onDragStart={(event) => {
                if (!commit) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", commit.hash);
                setDragged(commit.hash);
              }}
              onDragOver={(event) => {
                if (!dragged || !canMove || !commit) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                const below = event.clientY > box.top + box.height / 2;
                if (dropAt?.hash !== commit.hash || dropAt.below !== below) setDropAt({ hash: commit.hash, below });
              }}
              onDrop={(event) => {
                if (!dragged || !canMove || !commit) return;
                event.preventDefault();
                drop(commit.hash, dropAt?.below ?? false);
              }}
              onDragEnd={() => {
                setDragged(null);
                setDropAt(null);
              }}
            >
              <button
                onClick={(event) => select(commit, event)}
                onContextMenu={(event) => openMenu(event, commit)}
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
      {menu?.target ? (
        menu.target === STASH ? (
          branchStash && <ContextMenu x={menu.x} y={menu.y} entries={stashEntries} onClose={closeMenu} />
        ) : (
          <CommitContextMenu commit={menu.target} x={menu.x} y={menu.y} onClose={closeMenu} />
        )
      ) : (
        menu && <ContextMenu x={menu.x} y={menu.y} entries={pendingEntries} onClose={closeMenu} />
      )}
      {discardDialog}
    </>
  );
}
