import { laneColor, type GraphLine, type GraphRow } from "../../utils/commitGraph";

/** Height of one history row; the graph SVG and the row CSS must agree. */
export const ROW_HEIGHT = 32;
export const LANE_WIDTH = 16;
const NODE_RADIUS = 5;

/** Horizontal centre of a lane, in SVG units. */
const laneX = (lane: number): number => LANE_WIDTH / 2 + lane * LANE_WIDTH;

/** SVG path for one line segment within a row (see `GraphLine.part`). */
function linePath({ from, to, part }: GraphLine): string {
  const x1 = laneX(from);
  const x2 = laneX(to);
  const mid = ROW_HEIGHT / 2;
  if (part === "through") return `M${x1} 0V${ROW_HEIGHT}`;
  if (part === "top") return `M${x1} 0C${x1} ${mid} ${x2} 0 ${x2} ${mid}`;
  return `M${x1} ${mid}C${x2} ${mid} ${x2} ${mid} ${x2} ${ROW_HEIGHT}`;
}

interface CommitGraphCellProps {
  row: GraphRow;
  /** Width of the whole graph column, so every row lines up. */
  width: number;
  /** Pending changes draw a hollow, dashed node instead of a filled one. */
  pending: boolean;
}

/** The graph slice for one history row: lane lines plus the commit's node. */
export default function CommitGraphCell({
  row,
  width,
  pending,
}: CommitGraphCellProps): React.JSX.Element {
  const color = laneColor(row.lane);

  return (
    <svg className="graph" width={width} height={ROW_HEIGHT}>
      {row.lines.map((line, index) => (
        <path
          key={index}
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
        fill={pending ? "var(--panel)" : color}
        stroke={color}
        strokeDasharray={pending ? "2 2" : undefined}
      />
    </svg>
  );
}
