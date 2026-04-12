import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutomationScheduler } from "./scheduler";

function createMockRun(resolveWith: { pid: number } = { pid: 1234 }) {
  return vi.fn(async (_jobId: string) => resolveWith);
}

function createFailingRun(error = "spawn failed") {
  return vi.fn(async (_jobId: string): Promise<{ pid: number }> => { throw new Error(error); });
}

/** Wait for microtasks + timers to flush. */
async function flush(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe("AutomationScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueue basic — job dispatches immediately and becomes running", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    const run = createMockRun();

    const { job, deduped } = scheduler.enqueue({
      kind: "task",
      dedupeKey: "task:1",
      priority: "user",
      run,
    });

    expect(deduped).toBe(false);
    // enqueue triggers sync pump → dispatching (run is async)
    expect(job.status).toBe("dispatching");

    await flush();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(job.id);
    expect(job.status).toBe("running");

    scheduler.shutdown();
  });

  it("dedup hit — same key returns deduped", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    const run = createMockRun();

    const first = scheduler.enqueue({ kind: "webhook", dedupeKey: "wh:1", priority: "background", run });
    await flush();

    const second = scheduler.enqueue({ kind: "webhook", dedupeKey: "wh:1", priority: "background", run });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(run).toHaveBeenCalledOnce(); // only first was dispatched

    scheduler.shutdown();
  });

  it("dedup miss after completion — same key can re-enqueue", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    const run = createMockRun();

    const first = scheduler.enqueue({ kind: "task", dedupeKey: "task:1", priority: "user", run });
    await flush();
    scheduler.markCompleted(first.job.id);

    const second = scheduler.enqueue({ kind: "task", dedupeKey: "task:1", priority: "user", run });
    expect(second.deduped).toBe(false);
    expect(second.job.id).not.toBe(first.job.id);

    scheduler.shutdown();
  });

  it("priority ordering — urgent before background", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 1 });
    const order: string[] = [];

    // Fill the slot first
    const blocker = createMockRun();
    scheduler.enqueue({ kind: "task", dedupeKey: "blocker", priority: "user", run: blocker });
    await flush();

    // Queue two jobs while slot is full
    const bgRun = vi.fn(async (_jobId: string) => {
      order.push("background");
      return { pid: 2 };
    });
    const urgentRun = vi.fn(async (_jobId: string) => {
      order.push("urgent");
      return { pid: 3 };
    });

    scheduler.enqueue({ kind: "task", dedupeKey: "bg", priority: "background", run: bgRun });
    scheduler.enqueue({ kind: "task", dedupeKey: "urg", priority: "urgent", run: urgentRun });

    // Free the slot
    const status = scheduler.getStatus();
    expect(status.queueLength).toBe(2);

    scheduler.markCompleted(scheduler.getStatus().recentCompletions.length > 0 ? "" : "");
    // Actually mark the blocker completed — need its job id
    // The blocker job id is from the first enqueue
    const blockerJobId = blocker.mock.calls[0]?.[0];
    if (blockerJobId) scheduler.markCompleted(blockerJobId);

    await flush();

    // urgent should run first
    expect(order[0]).toBe("urgent");

    // Complete urgent, let background run
    if (urgentRun.mock.calls[0]?.[0]) {
      scheduler.markCompleted(urgentRun.mock.calls[0][0]);
    }
    await flush(1100); // pump interval

    expect(order).toEqual(["urgent", "background"]);

    scheduler.shutdown();
  });

  it("concurrency limit — respects maxConcurrentJobs", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });

    const runs = [createMockRun({ pid: 1 }), createMockRun({ pid: 2 }), createMockRun({ pid: 3 })];

    scheduler.enqueue({ kind: "task", dedupeKey: "a", priority: "user", run: runs[0] });
    scheduler.enqueue({ kind: "task", dedupeKey: "b", priority: "user", run: runs[1] });
    scheduler.enqueue({ kind: "task", dedupeKey: "c", priority: "user", run: runs[2] });

    await flush();

    expect(runs[0]).toHaveBeenCalledOnce();
    expect(runs[1]).toHaveBeenCalledOnce();
    expect(runs[2]).not.toHaveBeenCalled(); // blocked by concurrency

    const status = scheduler.getStatus();
    expect(status.runningCount).toBe(2);
    expect(status.queueLength).toBe(1);

    scheduler.shutdown();
  });

  it("retry on failure — re-queues with incremental delay", async () => {
    const scheduler = new AutomationScheduler({
      maxConcurrentJobs: 2,
      retryDelayMs: 100, // fast for test
      maxAttempts: 3,
    });

    let callCount = 0;
    const run = vi.fn(async (_jobId: string) => {
      callCount++;
      if (callCount < 3) throw new Error("transient");
      return { pid: 999 };
    });

    scheduler.enqueue({ kind: "task", dedupeKey: "retry-test", priority: "user", run });
    await flush(); // attempt 1 dispatched + fails async
    expect(callCount).toBe(1);

    // Advance past retry delay (attempt=1 * 100ms) + pump interval (1000ms)
    await vi.advanceTimersByTimeAsync(1200);
    expect(callCount).toBe(2); // attempt 2 fails

    // Advance past retry delay (attempt=2 * 100ms = 200ms) + pump interval
    await vi.advanceTimersByTimeAsync(1300);
    expect(callCount).toBe(3); // attempt 3 succeeds

    scheduler.shutdown();
  });

  it("retry exhausted — becomes failed", async () => {
    const scheduler = new AutomationScheduler({
      maxConcurrentJobs: 2,
      retryDelayMs: 50,
      maxAttempts: 2,
    });

    const run = createFailingRun("always fails");
    scheduler.enqueue({ kind: "webhook", dedupeKey: "fail-test", priority: "user", run });

    await flush(); // attempt 1 dispatched + fails
    // Advance past retry delay (attempt=1 * 50ms) + pump interval (1000ms)
    await vi.advanceTimersByTimeAsync(1200); // attempt 2 dispatched + fails → exhausted

    const status = scheduler.getStatus();
    expect(status.recentCompletions).toHaveLength(1);
    expect(status.recentCompletions[0].status).toBe("failed");
    expect(status.recentCompletions[0].errorMessage).toBe("always fails");

    scheduler.shutdown();
  });

  it("getStatus — accurate counts", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 1 });
    const run = createMockRun();

    scheduler.enqueue({ kind: "task", dedupeKey: "s1", priority: "user", run });
    scheduler.enqueue({ kind: "task", dedupeKey: "s2", priority: "user", run: createMockRun() });

    await flush();

    const status = scheduler.getStatus();
    expect(status.runningCount).toBe(1);
    expect(status.queueLength).toBe(1);

    scheduler.shutdown();
  });

  it("markCompleted/markFailed — external lifecycle", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    const run = createMockRun();

    const { job } = scheduler.enqueue({ kind: "task", dedupeKey: "ext", priority: "user", run });
    await flush();

    scheduler.markCompleted(job.id);

    const status = scheduler.getStatus();
    expect(status.runningCount).toBe(0);
    expect(status.recentCompletions).toHaveLength(1);
    expect(status.recentCompletions[0].status).toBe("completed");

    scheduler.shutdown();
  });

  it("shutdown — stops pump timer", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    scheduler.shutdown();

    const run = createMockRun();
    scheduler.enqueue({ kind: "task", dedupeKey: "post-shutdown", priority: "user", run });

    // Enqueue still triggers immediate pump, but timer won't fire again
    await flush();
    expect(run).toHaveBeenCalledOnce(); // immediate pump still works

    scheduler.shutdown();
  });

  it("recent completions ring buffer — caps at max", async () => {
    const scheduler = new AutomationScheduler({
      maxConcurrentJobs: 100,
      maxRecentCompletions: 3,
    });

    for (let i = 0; i < 5; i++) {
      const run = createMockRun({ pid: i });
      const { job } = scheduler.enqueue({
        kind: "task",
        dedupeKey: `ring-${i}`,
        priority: "user",
        run,
      });
      await flush();
      scheduler.markCompleted(job.id);
    }

    const status = scheduler.getStatus();
    expect(status.recentCompletions).toHaveLength(3);
    // Should keep the 3 most recent (ring-2, ring-3, ring-4)
    expect(status.recentCompletions[0].dedupeKey).toBe("ring-2");
    expect(status.recentCompletions[2].dedupeKey).toBe("ring-4");

    scheduler.shutdown();
  });

  it("idempotent markCompleted — no-op on already finalized", async () => {
    const scheduler = new AutomationScheduler({ maxConcurrentJobs: 2 });
    const run = createMockRun();
    const { job } = scheduler.enqueue({ kind: "task", dedupeKey: "idem", priority: "user", run });
    await flush();

    scheduler.markCompleted(job.id);
    scheduler.markCompleted(job.id); // second call is no-op

    const status = scheduler.getStatus();
    expect(status.recentCompletions).toHaveLength(1);

    scheduler.shutdown();
  });
});
