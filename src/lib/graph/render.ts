// Canvas painter for the commit graph. Draws only the rows in [first, last].
import Color from "color";
import type { GraphItem } from "$lib/stores/repo.svelte";
import type { GraphLayout, Segment } from "./layout";

export const ROW_H = 28;
export const LANE_W = 20;
export const NODE_R = 9;
export const GRAPH_PAD = 14;

export const LANE_COLORS = [
  "#15a0bf", // teal
  "#8e63d6", // violet
  "#e3a93b", // amber
  "#e25a86", // rose
  "#4fb86a", // green
  "#4a8ee8", // sky
  "#ef7a3c", // orange
  "#c05ad6", // magenta
];

export const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length];

const dimCache = new Map<string, string>();
export function laneColorAlpha(i: number, alpha: number) {
  const key = `${i % LANE_COLORS.length}:${alpha}`;
  let v = dimCache.get(key);
  if (!v) {
    v = Color(laneColor(i)).alpha(alpha).rgb().string();
    dimCache.set(key, v);
  }
  return v;
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable avatar background from an email. */
const avatarCache = new Map<string, string>();
export function avatarColor(email: string): string {
  const cached = avatarCache.get(email);
  if (cached) return cached;
  let h = 0;
  for (let i = 0; i < email.length; i++)
    h = (h * 31 + email.charCodeAt(i)) >>> 0;
  const c = Color.hsl(h % 360, 45, 38).hex();
  avatarCache.set(email, c);
  return c;
}

export const laneX = (lane: number) => GRAPH_PAD + lane * LANE_W;

export interface PaintOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  scrollTop: number;
  first: number;
  last: number;
  layout: GraphLayout;
  items: GraphItem[];
  /** x offset where the graph column starts (the refs column sits to its left). */
  graphX: number;
  graphW: number;
  selectedIndex: number;
  hoverIndex: number;
  /** Row indices that have ref pills (a connector is drawn from the pill to the node). */
  refRows: Set<number>;
  refPillEnd: number;
  background: string;
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  s: Segment,
  x0: number,
  yTop: number,
) {
  const fx = x0 + laneX(s.fromLane);
  const tx = x0 + laneX(s.toLane);
  const fy = yTop + s.fromY * ROW_H;
  const ty = yTop + s.toY * ROW_H;
  ctx.beginPath();
  if (fx === tx) {
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
  } else {
    const r = Math.min(ROW_H / 2, Math.abs(tx - fx));
    const dir = Math.sign(tx - fx);
    if (s.fromY === 0.5) {
      // From a node out to another lane: horizontal, then round the corner downwards.
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx - dir * r, fy);
      ctx.quadraticCurveTo(tx, fy, tx, fy + r);
      ctx.lineTo(tx, ty);
    } else {
      // From the top of a lane into a node: down, then round the corner horizontally.
      const my = ty;
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, my - r);
      ctx.quadraticCurveTo(fx, my, fx + dir * r, my);
      ctx.lineTo(tx, ty);
    }
  }
  ctx.strokeStyle = laneColor(s.color);
  ctx.stroke();
}

export function paintGraph(o: PaintOptions) {
  const { ctx, layout, items } = o;
  ctx.clearRect(0, 0, o.width, o.height);
  const x0 = o.graphX;

  // Row highlight bands (selected / hover) from the node to the edge of the graph column.
  for (const [idx, alpha] of [
    [o.hoverIndex, 0.12],
    [o.selectedIndex, 0.3],
  ] as const) {
    if (idx < o.first || idx > o.last || idx < 0) continue;
    const row = layout.rows[idx];
    if (!row) continue;
    const y = idx * ROW_H - o.scrollTop;
    const cx = x0 + laneX(row.lane);
    ctx.fillStyle = laneColorAlpha(row.color, alpha);
    ctx.fillRect(cx, y + 2, x0 + o.graphW - cx, ROW_H - 4);
  }

  // Edges.
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = o.first; i <= o.last; i++) {
    const row = layout.rows[i];
    if (!row) continue;
    const y = i * ROW_H - o.scrollTop;
    for (const s of row.segments) {
      // The WIP row's link to HEAD is dashed.
      if (items[i]?.kind === "wip" || items[i]?.kind === "stash")
        ctx.setLineDash(s.fromY === 0.5 ? [3, 3] : []);
      drawSegment(ctx, s, x0, y);
      ctx.setLineDash([]);
    }
  }

  // Ref pill connectors.
  for (const i of o.refRows) {
    if (i < o.first || i > o.last) continue;
    const row = layout.rows[i];
    const y = i * ROW_H - o.scrollTop + ROW_H / 2;
    ctx.beginPath();
    ctx.moveTo(o.refPillEnd, y);
    ctx.lineTo(x0 + laneX(row.lane), y);
    ctx.strokeStyle = laneColor(row.color);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Nodes.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 8.5px system-ui, sans-serif";
  for (let i = o.first; i <= o.last; i++) {
    const row = layout.rows[i];
    const item = items[i];
    if (!row || !item) continue;
    const cx = x0 + laneX(row.lane);
    const cy = i * ROW_H - o.scrollTop + ROW_H / 2;
    const color = laneColor(row.color);

    if (item.kind === "wip") {
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = o.background;
      ctx.fill();
      ctx.setLineDash([2.5, 2.5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    if (item.kind === "stash") {
      const s = NODE_R - 1;
      ctx.beginPath();
      ctx.roundRect(cx - s, cy - s, s * 2, s * 2, 3);
      ctx.fillStyle = o.background;
      ctx.fill();
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      // A little "box" glyph.
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3.5, cy - 1, 7, 1.5);
      ctx.fillRect(cx - 3.5, cy + 1.5, 7, 1.5);
      continue;
    }
    const isMerge = item.commit.parents.length > 1;
    if (isMerge) {
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = o.background;
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_R + 1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_R - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = avatarColor(item.commit.author.email);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(initials(item.commit.author.name), cx, cy + 0.5);
  }
}
