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
  /**
   * Draw this node, and its line down to its first parent, in the colour of
   * the lane that parent sits in, even when this node had to take a lane of
   * its own (a stash pushed aside by the uncommitted changes).
   */
  parentColor?: boolean;
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

/** Layout of one row: the lane its node sits in, its colour and the lines crossing it. */
export interface GraphRow {
  lane: number;
  /** The node's colour, as a lane number for `laneColor`; usually its own lane. */
  color: number;
  lines: GraphLine[];
}

export interface CommitGraph {
  rows: GraphRow[];
  laneCount: number;
}

/** How many lane colours the theme defines (`--lane-0` to `--lane-7` in theme.css). */
const LANE_COLORS = 8;

/** Colour for a lane, wrapping around the theme's palette, as a CSS value. */
export const laneColor = (lane: number): string => `var(--lane-${lane % LANE_COLORS})`;

/**
 * The lanes of one part of the graph as the rows go by: which commit each
 * lane is heading for. The main history and the orphan histories each get
 * one, side by side.
 */
class Lanes {
  // lanes[i] is the hash lane i is waiting to reach, or null if free;
  // dashed[i] is whether the line running down lane i is dashed.
  private lanes: (string | null)[] = [];
  private dashed: boolean[] = [];
  /** The widest these lanes got. */
  width = 0;
  // Lane 0 is held back for the trunk until its tip has been placed.
  private trunkReserved: boolean;

  constructor(
    private trunk: string | undefined,
    private trunkChain: Set<string>,
  ) {
    this.trunkReserved = trunkChain.size > 0;
    if (this.trunkReserved) this.lanes.push(null);
  }

  /** Leftmost free lane (never lane 0 while it is held for the trunk), else a new one. */
  private freeLane(): number {
    for (let i = this.trunkReserved ? 1 : 0; i < this.lanes.length; i++) {
      if (this.lanes[i] === null) return i;
    }
    return this.lanes.length;
  }

  /** Lines for a row whose node is in another part: every busy lane passes by. */
  through(): GraphLine[] {
    return this.lanes.flatMap((expected, i) =>
      expected === null ? [] : [{ from: i, to: i, part: "through" as const, color: i, dashed: this.dashed[i] }],
    );
  }

  /** Places `node`: its lane and the lines of its row. */
  place(node: GraphNode): { lane: number; lines: GraphLine[] } {
    const { lanes, dashed } = this;
    const lines: GraphLine[] = [];
    let lane: number;
    if (this.trunkChain.has(node.hash)) {
      lane = 0;
      this.trunkReserved = false;
      if (lanes.length === 0) lanes.push(null);
    } else {
      lane = lanes.indexOf(node.hash);
      if (lane === -1) lane = this.freeLane();
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
      let target = this.trunkReserved && parent === this.trunk ? 0 : lanes.indexOf(parent);
      if (target === -1) target = this.freeLane();
      if (lanes[target] !== parent) {
        lanes[target] = parent;
        dashed[target] = false;
      }
      lines.push({ from: lane, to: target, part: "bottom", color: target, dashed: false });
    }

    // Drop free lanes off the right edge so the graph narrows again
    // (keeping the reserved lane 0).
    while (lanes.length > (this.trunkReserved ? 1 : 0) && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    this.width = Math.max(this.width, lane + 1, lanes.length);
    return { lane, lines };
  }
}

/**
 * The nodes of orphan histories: those not connected to the trunk's
 * history at all, through any parent or child, that have a root commit of
 * their own (an `git checkout --orphan` branch, or an unrelated history).
 * A history cut off by the commit limit has no root here, so it isn't one.
 */
function orphanNodes(nodes: GraphNode[], trunk: string | undefined): Set<string> {
  const group = new Map(nodes.map((node) => [node.hash, node.hash]));
  if (trunk === undefined || !group.has(trunk)) return new Set();
  const find = (hash: string): string => {
    let root = hash;
    while (group.get(root) !== root) root = group.get(root) ?? root;
    group.set(hash, root);
    return root;
  };
  for (const node of nodes) {
    for (const parent of node.parents) {
      if (group.has(parent)) group.set(find(node.hash), find(parent));
    }
  }
  const main = find(trunk);
  // Groups with a real root commit (stash and pending rows don't count).
  const rooted = new Set(
    nodes.filter((node) => node.parents.length === 0 && !node.dashed).map((node) => find(node.hash)),
  );
  return new Set(
    nodes.filter((node) => find(node.hash) !== main && rooted.has(find(node.hash))).map((node) => node.hash),
  );
}

/**
 * Assigns each node a lane and works out the lines to draw in its row.
 * Returns one row per input node, in the same order, plus the widest lane
 * count so the graph column can be sized.
 *
 * `trunk` is the hash of the main branch tip. Its first-parent chain always
 * sits in lane 0, so branches ahead of main get lanes of their own instead
 * of taking over main's column just because their tip is drawn first.
 * Orphan histories (see `orphanNodes`) get lanes to the right of everything
 * else.
 */
export function buildCommitGraph(nodes: GraphNode[], trunk?: string): CommitGraph {
  // Walk the trunk's first parents to find the commits that belong in lane 0.
  const byHash = new Map(nodes.map((node) => [node.hash, node]));
  const trunkChain = new Set<string>();
  for (let hash = trunk; hash !== undefined && byHash.has(hash); ) {
    trunkChain.add(hash);
    hash = byHash.get(hash)?.parents[0];
  }

  const orphans = orphanNodes(nodes, trunk);
  const main = new Lanes(trunk, trunkChain);
  const side = new Lanes(undefined, new Set());
  const placed = nodes.map((node) => {
    const orphan = orphans.has(node.hash);
    const { lane, lines } = (orphan ? side : main).place(node);
    return { orphan, lane, lines, passing: (orphan ? main : side).through() };
  });

  // The orphan lanes sit right of the widest the main lanes got.
  const offset = main.width;
  const shift = (line: GraphLine): GraphLine => ({
    ...line,
    from: line.from + offset,
    to: line.to + offset,
    color: line.color + offset,
  });
  const rows = placed.map(({ orphan, lane, lines, passing }): GraphRow => {
    const own = orphan ? lines.map(shift) : lines;
    const other = orphan ? passing : passing.map(shift);
    const at = orphan ? lane + offset : lane;
    return { lane: at, color: at, lines: [...own, ...other] };
  });

  colorByParents(nodes, rows);
  return { rows, laneCount: main.width + side.width };
}

/**
 * Recolours each `parentColor` node, and its lane down to its first parent,
 * with the colour of the lane that parent sits in.
 */
function colorByParents(nodes: GraphNode[], rows: GraphRow[]): void {
  const rowOf = new Map(nodes.map((node, index) => [node.hash, index]));
  nodes.forEach((node, index) => {
    const parent = rowOf.get(node.parents[0] ?? "");
    if (!node.parentColor || parent === undefined) return;
    const { lane } = rows[index];
    const color = rows[parent].color;
    rows[index].color = color;
    for (let i = index; i <= parent; i++) {
      for (const line of rows[i].lines) {
        const ours =
          (i === index && line.part === "bottom" && line.from === lane && line.to === lane) ||
          (i > index && i < parent && line.part === "through" && line.from === lane) ||
          (i === parent && line.part === "top" && line.from === lane);
        if (ours) line.color = color;
      }
    }
  });
}
