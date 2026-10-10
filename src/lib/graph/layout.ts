// Lane assignment for the commit graph.
//
// Rows arrive newest-first in an order where every commit precedes its parents
// (git log --date-order / --topo-order). We keep an array of "lanes", each holding
// the hash of the commit it is waiting for. See lumiere-git-spec.md §3.2.

export interface LayoutInput {
  hash: string;
  parents: string[];
}

/** A line drawn inside one row. y positions: 0 = row top, 0.5 = node centre, 1 = row bottom. */
export interface Segment {
  fromLane: number;
  fromY: 0 | 0.5;
  toLane: number;
  toY: 0.5 | 1;
  color: number;
  /** Line leads to/from a merge parent (drawn as a curve). */
  merge?: boolean;
}

export interface GraphRow {
  lane: number;
  color: number;
  segments: Segment[];
  /** Number of lanes in use across this row (for width). */
  width: number;
}

export interface GraphLayout {
  rows: GraphRow[];
  maxLanes: number;
}

export function layoutGraph(commits: LayoutInput[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;
  let maxLanes = 0;
  const rows: GraphRow[] = [];

  const freeSlot = (avoid = -1) => {
    for (let i = 0; i < lanes.length; i++)
      if (lanes[i] === null && i !== avoid) return i;
    return lanes.length;
  };

  for (const c of commits) {
    const segments: Segment[] = [];

    // 1. Which lanes are waiting for this commit?
    const waiting: number[] = [];
    for (let i = 0; i < lanes.length; i++)
      if (lanes[i] === c.hash) waiting.push(i);

    let lane: number;
    if (waiting.length) {
      lane = waiting[0];
    } else {
      // A branch tip: nobody points here yet.
      lane = freeSlot();
      laneColor[lane] = nextColor++;
    }
    const color = laneColor[lane];

    // 2. Pass-through lanes and incoming edges (top half).
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue;
      if (lanes[i] === c.hash) {
        segments.push({
          fromLane: i,
          fromY: 0,
          toLane: lane,
          toY: 0.5,
          color: laneColor[i],
          merge: i !== lane,
        });
      } else {
        segments.push({
          fromLane: i,
          fromY: 0,
          toLane: i,
          toY: 1,
          color: laneColor[i],
        });
      }
    }

    // 3. Free converged lanes; this commit's lane continues with its first parent.
    for (const i of waiting) lanes[i] = null;
    const [first, ...rest] = c.parents;
    if (first !== undefined) {
      lanes[lane] = first;
      laneColor[lane] = color;
      segments.push({
        fromLane: lane,
        fromY: 0.5,
        toLane: lane,
        toY: 1,
        color,
      });
    }

    // 4. Extra parents (merges): join an existing lane waiting for that parent, or open a new one.
    for (const p of rest) {
      let target = lanes.indexOf(p);
      if (target === -1) {
        target = freeSlot(lane);
        lanes[target] = p;
        laneColor[target] = nextColor++;
      }
      segments.push({
        fromLane: lane,
        fromY: 0.5,
        toLane: target,
        toY: 1,
        color: laneColor[target],
        merge: true,
      });
    }

    // Trim trailing empty lanes so the graph stays compact.
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    let width = lanes.length;
    for (const s of segments)
      width = Math.max(width, s.fromLane + 1, s.toLane + 1);
    width = Math.max(width, lane + 1);
    maxLanes = Math.max(maxLanes, width);
    rows.push({ lane, color, segments, width });
  }

  return { rows, maxLanes };
}
