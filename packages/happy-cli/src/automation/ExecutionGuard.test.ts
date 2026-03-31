import { describe, expect, it } from "vitest";
import { ExecutionGuard } from "./ExecutionGuard";

describe("ExecutionGuard", () => {
  it("tracks reserve start and end transitions", () => {
    const guard = new ExecutionGuard();

    expect(guard.reserve("user_message")).toBe(true);
    expect(guard.getSnapshot().state).toBe("dispatching");
    expect(guard.getSnapshot().activeReason).toBe("user_message");

    const generation = guard.start();
    expect(generation).toBe(1);
    expect(guard.getSnapshot().state).toBe("running");
    expect(guard.getSnapshot().generation).toBe(1);

    expect(guard.end(generation!)).toBe(true);
    expect(guard.getSnapshot().state).toBe("idle");
    expect(guard.getSnapshot().activeReason).toBeUndefined();
  });

  it("can cancel a dispatch reservation", () => {
    const guard = new ExecutionGuard();

    expect(guard.reserve("background_job")).toBe(true);
    expect(guard.cancelReservation()).toBe(true);
    expect(guard.getSnapshot().state).toBe("idle");
  });

  it("rejects stale end calls after abort bumps generation", () => {
    const guard = new ExecutionGuard();

    guard.reserve("user_message");
    const generation = guard.start();
    expect(generation).toBe(1);

    expect(guard.abort("abort")).toBe(true);
    expect(guard.getSnapshot().state).toBe("aborting");
    expect(guard.getSnapshot().generation).toBe(2);

    expect(guard.end(generation!)).toBe(false);
    expect(guard.getSnapshot().state).toBe("aborting");
  });

  it("supports restart flow before a new run begins", () => {
    const guard = new ExecutionGuard();

    expect(guard.requestRestart("mode_change")).toBe(true);
    expect(guard.getSnapshot().state).toBe("restarting");
    expect(guard.getSnapshot().activeReason).toBe("mode_change");

    const generation = guard.start();
    expect(generation).toBe(1);
    expect(guard.getSnapshot().state).toBe("running");
  });

  it("records transition callbacks", () => {
    const transitions: string[] = [];
    const guard = new ExecutionGuard(({ from, to }) => {
      transitions.push(`${from.state}->${to.state}`);
    });

    guard.reserve("user_message");
    const generation = guard.start();
    guard.end(generation!);
    guard.close();

    expect(transitions).toEqual([
      "idle->dispatching",
      "dispatching->running",
      "running->idle",
      "idle->closed",
    ]);
  });
});
