import { describe, it, expect } from "vitest";
import {
  buildReapEnvelopePayload,
  REAPED_TASK_SUMMARY,
  selectStaleTasks,
  type InFlightTask,
} from "./inFlightTaskRegistry";

function task(overrides: Partial<InFlightTask> & { taskId: string }): InFlightTask {
  return {
    toolUseId: undefined,
    description: "explore something",
    startedAt: 0,
    lastActivityAt: 0,
    backgrounded: false,
    ...overrides,
  };
}

describe("selectStaleTasks", () => {
  const NOW = 1_000_000;
  const THRESHOLD = 4 * 60_000; // 240_000

  it("returns nothing for an empty set", () => {
    expect(selectStaleTasks([], NOW, THRESHOLD)).toEqual([]);
  });

  it("reaps a task silent strictly longer than the threshold", () => {
    const stale = task({ taskId: "t1", lastActivityAt: NOW - THRESHOLD - 1 });
    expect(selectStaleTasks([stale], NOW, THRESHOLD)).toEqual([stale]);
  });

  it("does NOT reap a task exactly at the threshold boundary (grace window)", () => {
    const atBoundary = task({ taskId: "t1", lastActivityAt: NOW - THRESHOLD });
    expect(selectStaleTasks([atBoundary], NOW, THRESHOLD)).toEqual([]);
  });

  it("does NOT reap a task that heartbeat recently (live background agent)", () => {
    const live = task({ taskId: "t1", lastActivityAt: NOW - 1_000 });
    expect(selectStaleTasks([live], NOW, THRESHOLD)).toEqual([]);
  });

  it("partitions a mixed set, returning only the stale ones", () => {
    const dead = task({ taskId: "dead", lastActivityAt: NOW - THRESHOLD - 5 });
    const live = task({ taskId: "live", lastActivityAt: NOW - 10 });
    const result = selectStaleTasks([dead, live], NOW, THRESHOLD);
    expect(result).toEqual([dead]);
  });
});

describe("buildReapEnvelopePayload", () => {
  it("builds a stopped task-end with the reap summary", () => {
    const t = task({ taskId: "t1", toolUseId: "tool-1" });
    expect(buildReapEnvelopePayload(t, "stopped")).toEqual({
      t: "task-end",
      taskId: "t1",
      status: "stopped",
      summary: REAPED_TASK_SUMMARY,
      toolUseId: "tool-1",
    });
  });

  it("omits toolUseId entirely when unknown (no undefined key)", () => {
    const t = task({ taskId: "t1" });
    const payload = buildReapEnvelopePayload(t, "stopped");
    expect(payload).toEqual({
      t: "task-end",
      taskId: "t1",
      status: "stopped",
      summary: REAPED_TASK_SUMMARY,
    });
    expect("toolUseId" in payload).toBe(false);
  });
});
