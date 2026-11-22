/**
 * Lays commits out in lanes (columns) for the history graph. Commits must be
 * ordered children before parents, as `git log --date-order` returns them.
 * Each row lists the line segments drawn in it, so rows can render alone.
 *
 * Pure layout logic with no React or git dependencies.
 */

/** Minimal commit info the layout needs. */
export interface GraphNode {
  hash: string;
  parents: string[];
  // Lines from this node down to its parents are dashed (pending changes).
  dashed?: boolean;
}

/** A line segment drawn within one row, between lane `from` and lane `to`. */
export interface GraphLine {
  from: number;
  to: number;
  // "top": row top to the node, "bottom": node to row bottom,
  // "through": a lane passing this row without touching the node.
  part: "top" | "bottom" | "through";
  color: number;
  dashed: boolean;
}

/** Layout of one row: the lane its node sits in and the lines crossing it. */
export interface GraphRow {
  lane: number;
  lines: GraphLine[];
}

export interface CommitGraph {
  rows: GraphRow[];
  laneCount: number;
}

/** Palette cycled through by lane index. */
const LANE_COLORS = [
  "#2f9e8f",
  "#d9822b",
  "#7c5cc4",
  "#d6457a",
  "#3b82c4",
  "#8aa62e",
  "#c9a227",
  "#cc5a3a",
];

/** Colour for a lane, wrapping around the palette. */
export const laneColor = (lane: number): string =>
  LANE_COLORS[lane % LANE_COLORS.length];

/**
 * Assigns each node a lane and works out the lines to draw in its row.
 * Returns one row per input node, in the same order, plus the widest lane
 * count so the graph column can be sized.
 *
 * `trunk` is the hash of the main branch tip. Its first-parent chain always
 * sits in lane 0, so branches ahead of main get lanes of their own instead
 * of taking over main's column just because their tip is drawn first.
 */
export function buildCommitGraph(nodes: GraphNode[], trunk?: string): CommitGraph {
  // lanes[i] is the hash lane i is waiting to reach, or null if free;
  // dashed[i] is whether the line running down lane i is dashed.
  const lanes: (string | null)[] = [];
  const dashed: boolean[] = [];
  let laneCount = 0;

  // Walk the trunk's first parents to find the commits that belong in lane 0.
  const byHash = new Map(nodes.map((node) => [node.hash, node]));
  const trunkChain = new Set<string>();
  // Walk first parents from the tip until the chain leaves the loaded history.
  for (let hash = trunk; hash !== undefined && byHash.has(hash); ) {
    trunkChain.add(hash);
    hash = byHash.get(hash)?.parents[0];
  }
  // Lane 0 is held back for the trunk until its tip has been placed.
  let trunkReserved = trunkChain.size > 0;
  if (trunkReserved) lanes.push(null);

  // Leftmost free lane (never lane 0 while it is held for the trunk), else a new one.
  const freeLane = (): number => {
    for (let i = trunkReserved ? 1 : 0; i < lanes.length; i++) {
      if (lanes[i] === null) return i;
    }
    return lanes.length;
  };

  const rows = nodes.map((node): GraphRow => {
    const lines: GraphLine[] = [];
    let lane: number;
    if (trunkChain.has(node.hash)) {
      lane = 0;
      trunkReserved = false;
      if (lanes.length === 0) lanes.push(null);
    } else {
      lane = lanes.indexOf(node.hash);
      if (lane === -1) lane = freeLane();
    }

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
      // A merge from the trunk tip, drawn before the tip itself, heads
      // straight for lane 0 where the tip will sit.
      let target = trunkReserved && parent === trunk ? 0 : lanes.indexOf(parent);
      if (target === -1) target = freeLane();
      if (lanes[target] !== parent) {
        lanes[target] = parent;
        dashed[target] = false;
      }
      lines.push({ from: lane, to: target, part: "bottom", color: target, dashed: false });
    }

    // Drop free lanes off the right edge so the graph narrows again
    // (keeping the reserved lane 0).
    while (lanes.length > (trunkReserved ? 1 : 0) && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    laneCount = Math.max(laneCount, lane + 1, lanes.length);
    return { lane, lines };
  });

  return { rows, laneCount };
}
