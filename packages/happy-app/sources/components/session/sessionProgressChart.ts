/**
 * Session progress chart math — the pure data + geometry behind the
 * SessionProgressPanel's activity sparkline and timestamps.
 *
 * Extracted from `SessionProgressPanel.tsx` (~1356 lines), where these pure
 * functions were private and reachable only by rendering the panel. The
 * bug-prone parts are exactly the ones a render-only test can't pin:
 *   - bucketing leaves into a fixed-width sparkline (clamp at count-1, zero/one
 *     leaf, all-same-timestamp span),
 *   - the SVG smooth-path geometry (single point vs many, fill closing),
 *   - relative-time threshold math (the 59s→60s boundary, clock-skew clamp).
 *
 * Relative time is split into a pure `relativeTimeParts` (the math) so it is
 * testable without i18n; the component maps the parts onto `t(...)`.
 */

import type { Message } from "@/sync/typesMessage";

export interface ActivityBucket {
  user: number;
  agent: number;
  tool: number;
}

export interface SparklineData {
  buckets: ActivityBucket[];
  startMs: number;
  endMs: number;
}

/**
 * Distribute message leaves (including tool-call children) across `count`
 * time-proportional buckets, counting user / agent / tool activity per bucket.
 */
export function buildSparklineData(
  messages: readonly Message[],
  count: number,
): SparklineData {
  const buckets: ActivityBucket[] = Array.from({ length: count }, () => ({
    user: 0,
    agent: 0,
    tool: 0,
  }));
  if (messages.length === 0) return { buckets, startMs: 0, endMs: 0 };

  type Leaf = { createdAt: number; kind: Message["kind"] };
  const leaves: Leaf[] = [];
  const walk = (msg: Message) => {
    leaves.push({ createdAt: msg.createdAt, kind: msg.kind });
    if (msg.kind === "tool-call") {
      for (const child of msg.children) walk(child);
    }
  };
  for (const m of messages) walk(m);
  if (leaves.length === 0) return { buckets, startMs: 0, endMs: 0 };

  let minTs = leaves[0].createdAt;
  let maxTs = leaves[0].createdAt;
  for (const leaf of leaves) {
    if (leaf.createdAt < minTs) minTs = leaf.createdAt;
    if (leaf.createdAt > maxTs) maxTs = leaf.createdAt;
  }
  const span = Math.max(1, maxTs - minTs);

  for (const leaf of leaves) {
    const idx = Math.min(count - 1, Math.floor(((leaf.createdAt - minTs) / span) * count));
    if (leaf.kind === "user-text") buckets[idx].user += 1;
    else if (leaf.kind === "agent-text") buckets[idx].agent += 1;
    else if (leaf.kind === "tool-call") buckets[idx].tool += 1;
  }
  return { buckets, startMs: minTs, endMs: maxTs };
}

/**
 * Build the SVG stroke + closed-fill path for a smoothed sparkline of `values`
 * normalized against `max` within a `width` x `height` box.
 */
export function buildSmoothPath(
  values: readonly number[],
  max: number,
  width: number,
  height: number,
): { stroke: string; fill: string } {
  if (values.length === 0 || max <= 0) return { stroke: "", fill: "" };
  const pad = 4;
  const usable = height - pad;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = usable - Math.min(1, v / max) * usable + 2;
    return [x, y] as const;
  });
  if (pts.length === 1) {
    const [, y] = pts[0];
    return {
      stroke: `M 0 ${y.toFixed(1)} L ${width.toFixed(1)} ${y.toFixed(1)}`,
      fill: `M 0 ${y.toFixed(1)} L ${width.toFixed(1)} ${y.toFixed(1)} L ${width.toFixed(1)} ${height} L 0 ${height} Z`,
    };
  }
  const stroke = pts
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = pts[i - 1];
      const cx = (px + x) / 2;
      return `C ${cx.toFixed(1)} ${py.toFixed(1)} ${cx.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts[pts.length - 1];
  const fill = `${stroke} L ${last[0].toFixed(1)} ${height} L ${pts[0][0].toFixed(1)} ${height} Z`;
  return { stroke, fill };
}

/** Format an absolute timestamp as `M/D HH:MM` in local time. */
export function formatTimeLabel(ms: number): string {
  const d = new Date(ms);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${M}/${D} ${hh}:${mm}`;
}

export type RelativeTimeParts =
  | { kind: "empty" }
  | { kind: "just-now" }
  | { kind: "minutes" | "hours" | "days"; n: number };

/**
 * Pure relative-time bucketing (no i18n). Clamps negative deltas (clock skew)
 * to 0. Thresholds: <60s just-now, <1h minutes, <1d hours, else days.
 */
export function relativeTimeParts(updatedAt: number | null, nowMs: number): RelativeTimeParts {
  if (updatedAt === null) return { kind: "empty" };
  const deltaSec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (deltaSec < 60) return { kind: "just-now" };
  if (deltaSec < 3600) return { kind: "minutes", n: Math.floor(deltaSec / 60) };
  if (deltaSec < 86400) return { kind: "hours", n: Math.floor(deltaSec / 3600) };
  return { kind: "days", n: Math.floor(deltaSec / 86400) };
}
