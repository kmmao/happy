import { describe, it, expect } from "vitest";
import { AutomationAuditStore } from "./auditStore";

describe("AutomationAuditStore", () => {
  it("record — assigns auto-incrementing id and timestamp", () => {
    const store = new AutomationAuditStore();
    const e1 = store.record({ kind: "job_enqueued", jobId: "j1" });
    const e2 = store.record({ kind: "job_completed", jobId: "j2" });

    expect(e1.id).toBe(1);
    expect(e2.id).toBe(2);
    expect(e1.timestamp).toBeLessThanOrEqual(e2.timestamp);
  });

  it("query — returns most recent first", () => {
    const store = new AutomationAuditStore();
    store.record({ kind: "job_enqueued", message: "first" });
    store.record({ kind: "job_completed", message: "second" });

    const results = store.query();
    expect(results[0].message).toBe("second");
    expect(results[1].message).toBe("first");
  });

  it("query — filters by kind", () => {
    const store = new AutomationAuditStore();
    store.record({ kind: "job_enqueued" });
    store.record({ kind: "job_completed" });
    store.record({ kind: "job_failed" });

    const failed = store.query({ kind: "job_failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0].kind).toBe("job_failed");
  });

  it("query — filters by loopId", () => {
    const store = new AutomationAuditStore();
    store.record({ kind: "loop_started", loopId: "L1" });
    store.record({ kind: "loop_started", loopId: "L2" });
    store.record({ kind: "loop_blocked", loopId: "L1" });

    const l1Events = store.query({ loopId: "L1" });
    expect(l1Events).toHaveLength(2);
  });

  it("query — respects limit", () => {
    const store = new AutomationAuditStore();
    for (let i = 0; i < 10; i++) {
      store.record({ kind: "job_enqueued", message: `msg-${i}` });
    }

    const limited = store.query({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[0].message).toBe("msg-9"); // most recent
  });

  it("ring buffer — caps at maxEntries", () => {
    const store = new AutomationAuditStore({ maxEntries: 3 });
    store.record({ kind: "job_enqueued", message: "a" });
    store.record({ kind: "job_enqueued", message: "b" });
    store.record({ kind: "job_enqueued", message: "c" });
    store.record({ kind: "job_enqueued", message: "d" });

    expect(store.size).toBe(3);
    const all = store.query({ limit: 100 });
    expect(all.map((e) => e.message)).toEqual(["d", "c", "b"]);
  });

  it("summarize — returns counts by kind", () => {
    const store = new AutomationAuditStore();
    store.record({ kind: "job_enqueued" });
    store.record({ kind: "job_enqueued" });
    store.record({ kind: "job_completed" });
    store.record({ kind: "job_failed" });

    const summary = store.summarize();
    expect(summary.job_enqueued).toBe(2);
    expect(summary.job_completed).toBe(1);
    expect(summary.job_failed).toBe(1);
    expect(summary.loop_started).toBe(0);
  });

  it("query — filters by since timestamp", () => {
    const store = new AutomationAuditStore();
    const e1 = store.record({ kind: "job_enqueued", message: "old" });
    const cutoff = Date.now() + 1;
    const e2 = store.record({ kind: "job_completed", message: "new" });

    // Manually adjust timestamp for test determinism
    (e1 as any).timestamp = cutoff - 100;
    (e2 as any).timestamp = cutoff + 100;

    const recent = store.query({ since: cutoff });
    expect(recent).toHaveLength(1);
    expect(recent[0].message).toBe("new");
  });
});
