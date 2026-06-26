import { describe, it, expect } from "vitest";
import {
  buildSparklineData,
  buildSmoothPath,
  formatTimeLabel,
  relativeTimeParts,
} from "./sessionProgressChart";
import type { Message } from "@/sync/typesMessage";

const userMsg = (createdAt: number): Message =>
  ({ kind: "user-text", createdAt } as unknown as Message);
const agentMsg = (createdAt: number): Message =>
  ({ kind: "agent-text", createdAt } as unknown as Message);
const toolMsg = (createdAt: number, children: Message[] = []): Message =>
  ({ kind: "tool-call", createdAt, children } as unknown as Message);

describe("buildSparklineData", () => {
  it("returns empty buckets and zero range for no messages", () => {
    const data = buildSparklineData([], 4);
    expect(data.buckets).toHaveLength(4);
    expect(data).toMatchObject({ startMs: 0, endMs: 0 });
    expect(data.buckets.every((b) => b.user === 0 && b.agent === 0 && b.tool === 0)).toBe(true);
  });

  it("places a single leaf in the first bucket and reports its timestamp range", () => {
    const data = buildSparklineData([userMsg(1000)], 4);
    expect(data.buckets[0].user).toBe(1);
    expect(data).toMatchObject({ startMs: 1000, endMs: 1000 });
  });

  it("distributes leaves time-proportionally and clamps the max timestamp to the last bucket", () => {
    const data = buildSparklineData([userMsg(0), agentMsg(50), toolMsg(100)], 4);
    expect(data.buckets[0].user).toBe(1); // t=0 → bucket 0
    expect(data.buckets[2].agent).toBe(1); // t=50 of span 100 → floor(0.5*4)=2
    expect(data.buckets[3].tool).toBe(1); // t=100 (max) clamped to count-1 = 3
  });

  it("walks tool-call children as their own leaves", () => {
    const data = buildSparklineData([toolMsg(0, [userMsg(0), agentMsg(0)])], 2);
    const totals = data.buckets.reduce(
      (acc, b) => ({ user: acc.user + b.user, agent: acc.agent + b.agent, tool: acc.tool + b.tool }),
      { user: 0, agent: 0, tool: 0 },
    );
    expect(totals).toEqual({ user: 1, agent: 1, tool: 1 });
  });
});

describe("buildSmoothPath", () => {
  it("returns empty paths for no values or a non-positive max", () => {
    expect(buildSmoothPath([], 10, 100, 40)).toEqual({ stroke: "", fill: "" });
    expect(buildSmoothPath([1, 2], 0, 100, 40)).toEqual({ stroke: "", fill: "" });
  });

  it("draws a horizontal line for a single value", () => {
    const { stroke, fill } = buildSmoothPath([5], 10, 100, 40);
    expect(stroke.startsWith("M 0 ")).toBe(true);
    expect(stroke).toContain("L 100.0");
    expect(fill.endsWith("Z")).toBe(true);
  });

  it("emits a cubic curve segment per gap and a closed fill for multiple values", () => {
    const { stroke, fill } = buildSmoothPath([0, 10, 5], 10, 100, 40);
    expect(stroke.startsWith("M ")).toBe(true);
    expect((stroke.match(/C /g) ?? []).length).toBe(2); // 3 points → 2 curves
    expect(fill.endsWith("Z")).toBe(true);
  });
});

describe("formatTimeLabel", () => {
  it("formats as M/D HH:MM with zero-padded time", () => {
    const ms = new Date(2024, 2, 5, 9, 7).getTime(); // Mar 5, 09:07 local
    expect(formatTimeLabel(ms)).toBe("3/5 09:07");
  });
});

describe("relativeTimeParts", () => {
  const now = 10_000_000;
  it("is empty for a null timestamp", () => {
    expect(relativeTimeParts(null, now)).toEqual({ kind: "empty" });
  });

  it("clamps a future timestamp (clock skew) to just-now", () => {
    expect(relativeTimeParts(now + 5000, now)).toEqual({ kind: "just-now" });
  });

  it("uses just-now below 60s and switches to minutes at exactly 60s", () => {
    expect(relativeTimeParts(now - 59_000, now)).toEqual({ kind: "just-now" });
    expect(relativeTimeParts(now - 60_000, now)).toEqual({ kind: "minutes", n: 1 });
  });

  it("buckets hours and days with floored counts", () => {
    expect(relativeTimeParts(now - 90 * 60_000, now)).toEqual({ kind: "hours", n: 1 });
    expect(relativeTimeParts(now - 50 * 3_600_000, now)).toEqual({ kind: "days", n: 2 });
  });
});
