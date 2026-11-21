import "./HistoryList.css";
import { useMemo } from "react";
import { useGitOperationsContext } from "../../context/GitOperationsContext";
import type { GitCommit, GitRef } from "../../types/git";
import {
  buildCommitGraph,
  laneColor,
  type GraphLine,
  type GraphNode,
} from "./commitGraph";

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const NODE_RADIUS = 5;
const PENDING = "pending";

const laneX = (lane: number): number => LANE_WIDTH / 2 + lane * LANE_WIDTH;

function linePath({ from, to, part }: GraphLine): string {
  const x1 = laneX(from);
  const x2 = laneX(to);
  const mid = ROW_HEIGHT / 2;
  if (part === "through") return `M${x1} 0V${ROW_HEIGHT}`;
  if (part === "top") return `M${x1} 0C${x1} ${mid} ${x2} ${0} ${x2} ${mid}`;
  return `M${x1} ${mid}C${x2} ${mid} ${x2} ${mid} ${x2} ${ROW_HEIGHT}`;
}

function RefBadge({ gitRef, color }: { gitRef: GitRef; color: string }) {
  return (
    <span
      className={`ref ref-${gitRef.type}${gitRef.current ? " current" : ""}`}
      style={{ borderColor: color }}
    >
      {gitRef.type === "tag" ? "◆ " : ""}
      {gitRef.name}
    </span>
  );
}

export default function HistoryList(): React.JSX.Element {
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
              <svg className="graph" width={width} height={ROW_HEIGHT}>
                {row.lines.map((line, lineIndex) => (
                  <path
                    key={lineIndex}
                    d={linePath(line)}
                    stroke={laneColor(line.color)}
                    strokeDasharray={line.dashed ? "3 3" : undefined}
                  />
                ))}
                <circle
                  className="node"
                  cx={laneX(row.lane)}
                  cy={ROW_HEIGHT / 2}
                  r={NODE_RADIUS}
                  fill={commit ? color : "var(--panel)"}
                  stroke={color}
                  strokeDasharray={commit ? undefined : "2 2"}
                />
              </svg>
              <span className="info">
                {commit ? (
                  <>
                    <b>{commit.message}</b>
                    <small>
                      {commit.author} · {commit.hash.slice(0, 7)} ·{" "}
                      {new Date(commit.date).toLocaleDateString()}
                    </small>
                  </>
                ) : (
                  <>
                    <b>Uncommitted changes</b>
                    <small>
                      {changeCount} changed file{changeCount === 1 ? "" : "s"}
                    </small>
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
