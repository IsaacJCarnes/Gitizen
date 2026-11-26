import "./CommitHistory.css";
import { useMemo } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { BranchStash, GitCommit } from "../../../shared/gitTypes";
import { buildCommitGraph, laneColor, type GraphNode } from "../../utils/commitGraph";
import { useContextMenu } from "../../hooks/useContextMenu";
import { pluralize, renamePaths, shortHash } from "../../utils/format";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { useDiscardConfirmation } from "../common/DiscardConfirm";
import { discardStashRequest, OPERATION_IN_PROGRESS, popLabel, stashItem } from "../Stash/stashMenu";
import CommitContextMenu from "./CommitContextMenu";
import CommitGraphCell, { LANE_WIDTH } from "./CommitGraphCell";
import RefBadge from "./RefBadge";

/** A stash's row in the history, drawn as a node of its own. */
interface StashRow {
  stash: BranchStash;
}

/** Graph key for a branch's stash row. */
const stashKey = (stash: BranchStash): string => `stash:${stash.branch}`;

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
 * several commits show their changes together.
 * Right-clicking a commit opens its menu (undo, amend and so on);
 * right-clicking "Uncommitted changes" offers to stash or discard them all,
 * and right-clicking the stash offers to pop or discard it.
 *
 * Every branch's stash is a node of its own, attached to the commit it was
 * made on (or its branch's tip, once that commit was undone or amended), in
 * a lane of its own. Clicking one shows its first file's changes.
 *
 * Double-clicking a local branch's badge checks that branch out.
 */
export default function CommitHistory(): React.JSX.Element {
  const git = useGitOperationsContext();
  const {
    commits,
    status,
    selectedCommit,
    selectedCommits,
    selectCommit,
    stashes,
    conflicts,
    selectedStash,
    selectStash,
    popStash,
    discardFiles,
    checkoutBranch,
  } = git;
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  // A commit's menu, or the "Uncommitted changes" row's (null) or a stash's.
  const { menu, openMenu, closeMenu } = useContextMenu<GitCommit | null | StashRow>();
  const changeCount = status?.files.length ?? 0;
  const hasPending = changeCount > 0;

  const graph = useMemo(() => {
    const nodes: GraphNode[] = commits.map(({ hash, parents }) => ({ hash, parents }));
    const loaded = new Set(commits.map((commit) => commit.hash));
    let trunk = findTrunk(commits);
    // Stashes go right after the uncommitted changes, each taking a lane over.
    nodes.unshift(
      ...stashes.map((stash) => ({
        hash: stashKey(stash),
        // A commit beyond the loaded history gets no line to nowhere.
        parents: loaded.has(stash.anchor) ? [stash.anchor] : [],
        dashed: true,
      })),
    );
    if (hasPending) {
      const head = commits.find((commit) => commit.refs.some((ref) => ref.current));
      nodes.unshift({ hash: PENDING, parents: head ? [head.hash] : [], dashed: true });
      // Changes on top of main stay in main's lane.
      if (head && head.hash === trunk) trunk = PENDING;
    }
    return buildCommitGraph(nodes, trunk);
  }, [commits, hasPending, stashes]);

  const width = graph.laneCount * LANE_WIDTH;
  // null stands for the "Uncommitted changes" row.
  const rows: (GitCommit | null | StashRow)[] = [
    ...(hasPending ? [null] : []),
    ...stashes.map((stash) => ({ stash })),
    ...commits,
  ];

  const selectedHashes = new Set(selectedCommits.map((commit) => commit.hash));

  /** A click: Ctrl (or Cmd) adds or removes a commit, Shift selects a range. */
  const select = (commit: GitCommit | null, event: React.MouseEvent): void => {
    if (commit && (event.ctrlKey || event.metaKey)) return selectCommit(commit, "toggle");
    if (commit && event.shiftKey) return selectCommit(commit, "range");
    const already = commit ? selectedCommits.length === 1 && selectedCommit?.hash === commit.hash : !selectedCommit;
    if (!already || selectedStash) selectCommit(commit);
  };

  // Popping, dropping or discarding needs nothing else in progress.
  const busy = conflicts.operation !== null ? OPERATION_IN_PROGRESS : undefined;
  const stashEntries = (stash: BranchStash): MenuEntry[] => {
    const pop = popLabel(stash, status?.branch);
    return [
      {
        label: pop.label,
        disabled: Boolean(busy),
        title: busy ?? pop.title,
        onSelect: () => void popStash(stash.branch),
      },
      {
        label: "Discard stash…",
        disabled: Boolean(busy),
        title: busy ?? "Delete the stash for good",
        onSelect: () => confirmDiscard(discardStashRequest(git, stash)),
      },
    ];
  };
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

  if (rows.length === 0) {
    return <p className="placeholder">No commits yet.</p>;
  }

  return (
    <>
      <ol className="commit-graph">
        {rows.map((entry, index) => {
          const row = graph.rows[index];
          const color = laneColor(row.lane);
          if (entry && "stash" in entry) {
            const { stash } = entry;
            const own = stash.branch === status?.branch;
            return (
              <li
                key={stashKey(stash)}
                className={`pending stash${selectedStash?.branch === stash.branch ? " on" : ""}`}
              >
                <button
                  onClick={() => selectStash(stash)}
                  title={`Show the changes stashed on ${stash.branch}`}
                  onContextMenu={(event) => openMenu(event, entry)}
                >
                  <span className="refs" />
                  <CommitGraphCell row={row} width={width} pending />
                  <span className="info">
                    <b>{own ? "Stash" : `Stash on ${stash.branch}`}</b>
                    <small>
                      {stash.message} · {pluralize(stash.files.length, "file")}
                    </small>
                  </span>
                </button>
              </li>
            );
          }
          const commit = entry;
          const selected = commit ? selectedHashes.has(commit.hash) : !selectedCommit && !selectedStash;

          return (
            <li
              key={commit?.hash ?? PENDING}
              className={`${commit ? "" : "pending"}${selected ? " on" : ""}`}
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
                    <RefBadge
                      key={`${ref.type}:${ref.name}`}
                      gitRef={ref}
                      color={color}
                      onCheckout={
                        ref.type === "branch" && !ref.current
                          ? () => void checkoutBranch(ref.name)
                          : undefined
                      }
                    />
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
        "stash" in menu.target ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            entries={stashEntries(menu.target.stash)}
            onClose={closeMenu}
          />
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
