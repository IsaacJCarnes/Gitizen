// Lays commits out in lanes (columns) for the history graph. Commits must be
// ordered children before parents, as `git log --date-order` returns them.
// Each row lists the line segments drawn in it, so rows can render alone.

export interface GraphNode {
  hash: string;
  parents: string[];
  // Lines from this node down to its parents are dashed (pending changes).
  dashed?: boolean;
}

export interface GraphLine {
  from: number;
  to: number;
  // "top": row top to the node, "bottom": node to row bottom,
  // "through": a lane passing this row without touching the node.
  part: "top" | "bottom" | "through";
  color: number;
  dashed: boolean;
}

export interface GraphRow {
  lane: number;
  lines: GraphLine[];
}

export interface CommitGraph {
  rows: GraphRow[];
  laneCount: number;
}

export const LANE_COLORS = [
  "#2f9e8f",
  "#d9822b",
  "#7c5cc4",
  "#d6457a",
  "#3b82c4",
  "#8aa62e",
  "#c9a227",
  "#cc5a3a",
];

export const laneColor = (lane: number): string =>
  LANE_COLORS[lane % LANE_COLORS.length];

export function buildCommitGraph(nodes: GraphNode[]): CommitGraph {
  // lanes[i] is the hash lane i is waiting to reach, or null if free.
  const lanes: (string | null)[] = [];
  const dashed: boolean[] = [];
  let laneCount = 0;

  const freeLane = (): number => {
    const index = lanes.indexOf(null);
    return index === -1 ? lanes.length : index;
  };

  const rows = nodes.map((node): GraphRow => {
    const lines: GraphLine[] = [];
    let lane = lanes.indexOf(node.hash);
    const isTip = lane === -1;
    if (isTip) lane = freeLane();

    // Lanes coming in from above: those waiting for this commit end here
    // (several of them when branches forked from it), the rest pass by.
    lanes.forEach((expected, i) => {
      if (expected === null) return;
      if (expected === node.hash) {
        lines.push({ from: i, to: lane, part: "top", color: i, dashed: dashed[i] });
        if (i !== lane) lanes[i] = null;
      } else {
        lines.push({ from: i, to: i, part: "through", color: i, dashed: dashed[i] });
      }
    });

    // Lanes going down: the first parent continues this lane, further
    // parents (merges) join a lane already heading there or open a new one.
    const [first, ...rest] = node.parents;
    if (first === undefined) {
      lanes[lane] = null;
    } else {
      lanes[lane] = first;
      dashed[lane] = node.dashed ?? false;
      lines.push({ from: lane, to: lane, part: "bottom", color: lane, dashed: dashed[lane] });
    }
    for (const parent of rest) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = freeLane();
        lanes[target] = parent;
        dashed[target] = false;
      }
      lines.push({ from: lane, to: target, part: "bottom", color: target, dashed: false });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lane + 1, lanes.length);
    return { lane, lines };
  });

  return { rows, laneCount };
}
