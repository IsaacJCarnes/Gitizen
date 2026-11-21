import "./CommitHistory.css";
import { useMemo } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { GitCommit } from "../../../shared/gitTypes";
import { buildCommitGraph, laneColor, type GraphNode } from "../../utils/commitGraph";
import { pluralize, shortHash } from "../../utils/format";
import CommitGraphCell, { LANE_WIDTH } from "./CommitGraphCell";
import RefBadge from "./RefBadge";

/** Graph key for the "Uncommitted changes" row, which has no real hash. */
const PENDING = "pending";

/**
 * The commit history as a graph across all branches. When the working tree
 * has changes, an "Uncommitted changes" row sits on top, attached to HEAD.
 * Clicking a row selects it; the sidebar then shows that row's files.
 */
export default function CommitHistory(): React.JSX.Element {
  const { commits, status, selectedCommit, selectCommit } =
    useGitOperationsContext();
  const changeCount = status?.files.length ?? 0;
  const hasPending = changeCount > 0;

  const graph = useMemo(() => {
    const nodes: GraphNode[] = commits.map(({ hash, parents }) => ({ hash, parents }));
    if (hasPending) {
      const head = commits.find((commit) => commit.refs.some((ref) => ref.current));
      nodes.unshift({ hash: PENDING, parents: head ? [head.hash] : [], dashed: true });
    }
    return buildCommitGraph(nodes);
  }, [commits, hasPending]);

  const width = graph.laneCount * LANE_WIDTH;
  // null stands for the "Uncommitted changes" row.
  const rows: (GitCommit | null)[] = hasPending ? [null, ...commits] : commits;

  const select = (commit: GitCommit | null): void => {
    if (commit?.hash !== selectedCommit?.hash) selectCommit(commit);
  };

  if (rows.length === 0) {
    return <p className="placeholder">No commits yet.</p>;
  }

  return (
    <ol className="commit-graph">
      {rows.map((commit, index) => {
        const row = graph.rows[index];
        const color = laneColor(row.lane);
        const selected = commit ? selectedCommit?.hash === commit.hash : !selectedCommit;

        return (
          <li
            key={commit?.hash ?? PENDING}
            className={`${commit ? "" : "pending"}${selected ? " on" : ""}`}
          >
            <button onClick={() => select(commit)}>
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
  );
}
